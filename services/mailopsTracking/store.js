import { feedHealth } from "./feedHealth.js";
import { randomBytes, randomUUID } from "node:crypto";
import { barcode, campaignInput, error, hash, LIMITS, parseFeed, parseManifest, requireCampaignId } from "./protocol.js";

export function createTrackingStore(pool) {
  const transaction = async (fn, readOnly = false) => {
    const db = await pool.connect();
    try {
      await db.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      await db.query("SET LOCAL statement_timeout = '15s'");
      await db.query("SET LOCAL lock_timeout = '3s'");
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); throw err; }
    finally { db.release(); }
  };
  async function firmLock(db, firm) {
    await db.query("SELECT id FROM mailops_tracking_budget WHERE id=1 FOR UPDATE");
    await db.query("INSERT INTO mailops_tracking_firms(firm_id) VALUES($1) ON CONFLICT DO NOTHING", [firm]);
    await db.query("SELECT firm_id FROM mailops_tracking_firms WHERE firm_id=$1 FOR UPDATE", [firm]);
  }
  async function campaign(db, firm, id, lock = false) {
    requireCampaignId(id);
    const { rows } = await db.query(`SELECT * FROM mailops_tracking_campaigns WHERE id=$1 AND firm_id=$2${lock ? " FOR UPDATE" : ""}`, [id, firm]);
    if (!rows[0]) throw error("CAMPAIGN_NOT_FOUND",404);
    return rows[0];
  }
  async function count(db, table, firm) {
    // Table names are internal constants supplied by this module.
    return Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE firm_id=$1`, [firm])).rows[0].n);
  }
  async function totalCount(db, table) {
    return Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  }
  const publicCampaign = c => ({
    id:c.id, name:c.name, mailing_date:c.mailing_date instanceof Date ? c.mailing_date.toISOString().slice(0,10) : String(c.mailing_date).slice(0,10),
    source_mode:c.source_mode, feed_enabled:Boolean(c.feed_token_hash),
  });
  return {
    async list(firm) {
      const {rows} = await pool.query("SELECT * FROM mailops_tracking_campaigns WHERE firm_id=$1 ORDER BY created_at DESC LIMIT 100", [firm]);
      return rows.map(publicCampaign);
    },
    async create(firm, user, body, mode) {
      const input = campaignInput(body);
      return transaction(async db => {
        await firmLock(db,firm);
        if (await count(db,"mailops_tracking_campaigns",firm) >= LIMITS.campaigns || await totalCount(db,"mailops_tracking_campaigns") >= LIMITS.total_campaigns) throw error("CAMPAIGN_STORAGE_LIMIT",409);
        const {rows} = await db.query("INSERT INTO mailops_tracking_campaigns(id,firm_id,created_by_user,name,mailing_date,source_mode) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [randomUUID(), firm, String(user), input.name, input.mailing_date, mode]);
        return publicCampaign(rows[0]);
      });
    },
    async manifest(firm, id, csv, apply, expectedPlan) {
      const parsed = parseManifest(csv);
      return transaction(async db => {
        await campaign(db,firm,id,true);
        const current = (await db.query("SELECT imb,sequence FROM mailops_tracking_pieces WHERE campaign_id=$1 AND firm_id=$2 ORDER BY imb", [id,firm])).rows;
        const batches = Number((await db.query("SELECT count(*) AS n FROM mailops_tracking_batches WHERE campaign_id=$1 AND firm_id=$2", [id,firm])).rows[0].n);
        if (batches) throw error("MANIFEST_FROZEN_AFTER_FEED",409);
        const existing = new Map(current.map(row=>[row.imb,row.sequence]));
        if (parsed.rows.some(r=>existing.has(r.imb) && existing.get(r.imb)!==r.sequence)) throw error("MANIFEST_SEQUENCE_CONFLICT",409);
        const additions = parsed.rows.filter(r=>!existing.has(r.imb));
        const plan = hash(JSON.stringify({id, current, rows:parsed.rows}));
        if (!apply) return {mode:"preview",plan,input_rows:parsed.rows.length,new_pieces:additions.length,existing_pieces:current.length};
        if (expectedPlan !== plan) throw error("MANIFEST_PLAN_CHANGED",409);
        await firmLock(db,firm);
        if (await count(db,"mailops_tracking_pieces",firm) + additions.length > LIMITS.pieces || await totalCount(db,"mailops_tracking_pieces")+additions.length>LIMITS.total_pieces) throw error("PIECE_STORAGE_LIMIT",409);
        if (additions.length) await db.query(
          `INSERT INTO mailops_tracking_pieces(campaign_id,firm_id,imb,sequence)
           SELECT $1,$2,x.imb,x.sequence FROM jsonb_to_recordset($3::jsonb) AS x(imb text,sequence text)`,
          [id,firm,JSON.stringify(additions)]);

        return {mode:"applied",inserted:additions.length,total_pieces:current.length+additions.length};
      });
    },
    async token(firm,id,revoke=false) {
      return transaction(async db => {
        await campaign(db,firm,id,true);
        const pieces = Number((await db.query("SELECT count(*) AS n FROM mailops_tracking_pieces WHERE campaign_id=$1 AND firm_id=$2",[id,firm])).rows[0].n);
        if (!revoke && !pieces) throw error("MANIFEST_REQUIRED",409);
        const token = revoke ? null : "miv_" + randomBytes(32).toString("base64url");
        await db.query("UPDATE mailops_tracking_campaigns SET feed_token_hash=$1 WHERE id=$2 AND firm_id=$3",[token ? hash(token) : null,id,firm]);
        return {token,revoked:revoke};
      });
    },
    async ingest(token,csv,authorize) {
      if (typeof token!=="string" || !/^miv_[A-Za-z0-9_-]{43}$/.test(token)) throw error("FEED_UNAUTHORIZED",401);
      return transaction(async db => {
        const c=(await db.query("SELECT * FROM mailops_tracking_campaigns WHERE feed_token_hash=$1 FOR UPDATE",[hash(token)])).rows[0];
        if (!c || !await authorize(c, db)) throw error("FEED_UNAUTHORIZED",401);
        const parsed=parseFeed(csv);
        const prior=(await db.query("SELECT input_rows,inserted_rows,unmatched_rows FROM mailops_tracking_batches WHERE campaign_id=$1 AND file_hash=$2",[c.id,parsed.file_hash])).rows[0];
        if(prior) return {duplicate:true,...prior};
        await firmLock(db,c.firm_id);
        if(await count(db,"mailops_tracking_batches",c.firm_id)>=LIMITS.batches || await totalCount(db,"mailops_tracking_batches")>=LIMITS.total_batches) throw error("FEED_STORAGE_LIMIT",409);
        const known=new Set((await db.query("SELECT imb FROM mailops_tracking_pieces WHERE campaign_id=$1 AND firm_id=$2",[c.id,c.firm_id])).rows.map(r=>r.imb));
        const matched=parsed.rows.filter(row=>known.has(row.imb));
        const unmatched=parsed.rows.length-matched.length;
        const inserted=matched.length ? (await db.query(
          `INSERT INTO mailops_tracking_events(campaign_id,firm_id,imb,event_key,event_time,event_code,event_type,facility,facility_zip)
           SELECT $1,$2,x.imb,x.event_key,x.event_time,x.event_code,x.event_type,x.facility,x.facility_zip
           FROM jsonb_to_recordset($3::jsonb) AS x(imb text,event_key text,event_time text,event_code text,event_type text,facility text,facility_zip text)
           ON CONFLICT DO NOTHING RETURNING event_key`,
          [c.id,c.firm_id,JSON.stringify(matched)])).rows.length : 0;
        if(await count(db,"mailops_tracking_events",c.firm_id)>LIMITS.events || await totalCount(db,"mailops_tracking_events")>LIMITS.total_events) throw error("EVENT_STORAGE_LIMIT",409);
        await db.query("INSERT INTO mailops_tracking_batches(campaign_id,firm_id,file_hash,input_rows,inserted_rows,unmatched_rows) VALUES($1,$2,$3,$4,$5,$6)",
          [c.id,c.firm_id,parsed.file_hash,parsed.rows.length,inserted,unmatched]);
        return {duplicate:false,input_rows:parsed.rows.length,inserted_rows:inserted,unmatched_rows:unmatched};
      });
    },
    async summary(firm,id) {
      return transaction(async db => {
      const c=await campaign(db,firm,id);
      const totals=(await db.query(`SELECT
        (SELECT count(*) FROM mailops_tracking_pieces WHERE campaign_id=$1 AND firm_id=$2) AS total_pieces,
        count(DISTINCT imb) AS observed_pieces,
        count(DISTINCT imb) FILTER(WHERE event_type='Actual') AS actual_scan_pieces,
        count(*) FILTER(WHERE event_type IN ('Assumed Actual','Assumed Logical')) AS assumed_events,
        count(*) FILTER(WHERE event_type='Logical') AS logical_events
        FROM mailops_tracking_events WHERE campaign_id=$1 AND firm_id=$2`,[id,firm])).rows[0];
      const receipts=(await db.query("SELECT received_at,input_rows,inserted_rows,unmatched_rows FROM mailops_tracking_batches WHERE campaign_id=$1 AND firm_id=$2 ORDER BY received_at DESC LIMIT 1",[id,firm])).rows;
      const pieces=(await db.query(`SELECT p.imb,p.sequence, count(e.event_key)::int AS event_count, max(e.event_time) AS latest_event
        FROM mailops_tracking_pieces p LEFT JOIN mailops_tracking_events e ON e.campaign_id=p.campaign_id AND e.firm_id=p.firm_id AND e.imb=p.imb
        WHERE p.campaign_id=$1 AND p.firm_id=$2 GROUP BY p.imb,p.sequence ORDER BY p.sequence,p.imb LIMIT 100`,[id,firm])).rows;
      const n=Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,Number(v)]));
      const totalsWithCoverage={...n,no_scan_received:n.total_pieces-n.observed_pieces};
      const batches=(await db.query(`SELECT count(*) AS receipt_count,
        coalesce(sum(input_rows),0) AS input_rows, coalesce(sum(inserted_rows),0) AS inserted_events,
        coalesce(sum(unmatched_rows),0) AS unmatched_rows
        FROM mailops_tracking_batches WHERE campaign_id=$1 AND firm_id=$2`,[id,firm])).rows[0];
      const sample=(await db.query(`SELECT p.imb,p.sequence FROM mailops_tracking_pieces p
        WHERE p.campaign_id=$1 AND p.firm_id=$2 AND NOT EXISTS(
          SELECT 1 FROM mailops_tracking_events e WHERE e.campaign_id=p.campaign_id
          AND e.firm_id=p.firm_id AND e.imb=p.imb)
        ORDER BY p.sequence,p.imb LIMIT 25`,[id,firm])).rows;
      const checked=(await db.query("SELECT CURRENT_TIMESTAMP AS checked_at")).rows[0].checked_at;
      const campaignInfo=publicCampaign(c),lastFeed=receipts[0]??null;
      return {campaign:campaignInfo,totals:totalsWithCoverage,last_feed:lastFeed,pieces,
        feed_health:feedHealth({campaign:campaignInfo,totals:totalsWithCoverage,lastFeed,batches,noEventSample:sample,now:checked})};
      }, true);
    },
    async events(firm,id,imb) {
      await campaign(pool,firm,id);
      barcode(imb);
      return (await pool.query("SELECT event_time,event_code,event_type,facility,facility_zip FROM mailops_tracking_events WHERE firm_id=$1 AND campaign_id=$2 AND imb=$3 ORDER BY event_time DESC LIMIT 100",[firm,id,imb])).rows;
    },
  };
}
