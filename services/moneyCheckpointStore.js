import crypto from 'node:crypto';
import { importError } from './fecMoneyProtocol.js';
import { donorProjection, vendorProjection } from './moneySnapshotProjection.js';

const decode = row => row && ({ id: row.id, status: row.status, cutoff: String(row.cutoff).slice(0, 10), cursor: row.cursor,
  pages: Number(row.pages), records: Number(row.records), anchor: row.anchor, publishCursor: row.publish_cursor, config: row.config });
export class MoneyCheckpointStore {
  constructor(client, { promotePoliticalRecord } = {}) { this.client = client; this.promotePoliticalRecord = promotePoliticalRecord; }
  async transaction(work) {
    await this.client.query('BEGIN');
    try { const result = await work(); await this.client.query('COMMIT'); return result; }
    catch (error) { await this.client.query('ROLLBACK').catch(() => {}); throw error; }
  }
  async load(config) {
    const r = await this.client.query(`SELECT s.*, s.cutoff::text AS cutoff FROM money_import_checkpoints c JOIN money_import_scans s ON s.id=c.active_scan_id WHERE c.lane=$1 AND c.cycle=$2 AND c.scope_key=$3`, [config.lane, config.cycle, config.key]);
    const state = decode(r.rows[0]);
    if (state && JSON.stringify(state.config) !== JSON.stringify(config)) {
      // JSONB key ordering is different from JS insertion order.
      for (const field of ['lane','cycle','key','national','perPage','protocol']) if (state.config[field] !== config[field]) throw importError('CHECKPOINT_CONFIG_MISMATCH', 409);
      if (JSON.stringify(state.config.committees) !== JSON.stringify(config.committees)) throw importError('CHECKPOINT_CONFIG_MISMATCH', 409);
    }
    return state;
  }
  async start(config, cutoff) {
    return this.transaction(async () => {
      const id = crypto.randomUUID();
      await this.client.query(`INSERT INTO money_import_scans(id,lane,cycle,scope_key,config,cutoff,cursor) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)`, [id,config.lane,config.cycle,config.key,JSON.stringify(config),cutoff,JSON.stringify(config.lane === 'political-money' ? {page:1} : {})]);
      await this.client.query(`INSERT INTO money_import_checkpoints(lane,cycle,scope_key,committees,active_scan_id) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(lane,cycle,scope_key) DO UPDATE SET active_scan_id=EXCLUDED.active_scan_id`,[config.lane,config.cycle,config.key,JSON.stringify(config.committees),id]);
      return this.load(config);
    });
  }
  async commitPage(config, state, page) {
    return this.transaction(async () => {
      const current = await this.client.query('SELECT pages FROM money_import_scans WHERE id=$1 FOR UPDATE',[state.id]);
      if (Number(current.rows[0]?.pages) !== state.pages) throw importError('CHECKPOINT_MOVED',409);
      if (page.records.length) {
        const repeated = await this.client.query('SELECT 1 FROM money_import_pages WHERE scan_id=$1 AND fingerprint=$2',[state.id,page.fingerprint]);
        if (repeated.rows.length) throw importError('PROVIDER_REPEATED_PAGE');
      }
      let inserted = 0;
      for (const record of page.records) {
        const old = await this.client.query('SELECT digest FROM money_import_records WHERE scan_id=$1 AND record_id=$2',[state.id,record.id]);
        if (old.rows.length && old.rows[0].digest !== record.digest) throw importError('PROVIDER_RECORD_CHANGED_DURING_SCAN');
        const saved = await this.client.query(`INSERT INTO money_import_records(scan_id,record_id,digest,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(scan_id,record_id) DO NOTHING RETURNING record_id`,[state.id,record.id,record.digest,JSON.stringify(record.payload)]);
        inserted += saved.rows.length;
      }
      await this.client.query(`INSERT INTO money_import_pages(scan_id,ordinal,fingerprint,rows_received) VALUES($1,$2,$3,$4)`,[state.id,state.pages+1,page.fingerprint,page.records.length]);
      const status = page.complete ? (state.records ? 'publishing' : 'no_data') : 'paused';
      await this.client.query(`UPDATE money_import_scans SET status=$2,cursor=$3::jsonb,pages=pages+1,records=records+$5,anchor=COALESCE(anchor,$4),last_error=NULL,updated_at=NOW(),completed_at=CASE WHEN $2='no_data' THEN NOW() ELSE NULL END WHERE id=$1`,[state.id,status,JSON.stringify(page.cursor),page.records.length?page.fingerprint:null,inserted]);
      return this.load(config);
    });
  }
  async publishChunk(config, state) {
    return this.transaction(async () => {
      const r = await this.client.query(`SELECT record_id,payload FROM money_import_records WHERE scan_id=$1 AND ($2::text IS NULL OR record_id>$2) ORDER BY record_id LIMIT 100`,[state.id,state.publishCursor || null]);
      for (const {record_id:id,payload} of r.rows) {
        if (payload.memoed === true || String(payload.memoed).toLowerCase() === 'true') continue;
        if (config.lane === 'vendors') {
          const value = vendorProjection(payload,config.cycle);
          await this.client.query(`INSERT INTO money_vendor_snapshots(scan_id,record_id,committee_id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(scan_id,record_id) DO NOTHING`,[state.id,id,payload.committee_id,JSON.stringify(value)]);
        } else if (config.lane === 'donors') {
          const {key,value} = donorProjection(payload,config.cycle);
          await this.client.query(`INSERT INTO money_donor_snapshots(scan_id,donor_key,committee_id,payload,amount,contributions) VALUES($1,$2,$3,$4::jsonb,$5::numeric,1) ON CONFLICT(scan_id,donor_key) DO UPDATE SET amount=money_donor_snapshots.amount+EXCLUDED.amount,contributions=money_donor_snapshots.contributions+1`,[state.id,key,payload.committee_id,JSON.stringify(value),value.amount]);
        } else {
          if (!this.promotePoliticalRecord) throw importError('POLITICAL_PROMOTER_MISSING');
          await this.promotePoliticalRecord(payload,config.cycle,this.client,{scanId:state.id,scopeKey:config.key});
        }
      }
      if (r.rows.length) {
        await this.client.query(`UPDATE money_import_scans SET publish_cursor=$2,updated_at=NOW(),last_error=NULL WHERE id=$1`,[state.id,r.rows.at(-1).record_id]);
      } else {
        await this.client.query(`UPDATE money_import_checkpoints SET published_scan_id=$4,published_at=NOW(),needs_scores=($1='political-money') WHERE lane=$1 AND cycle=$2 AND scope_key=$3`,[config.lane,config.cycle,config.key,state.id]);
        await this.client.query(`UPDATE money_import_scans SET status='completed',completed_at=NOW(),updated_at=NOW(),last_error=NULL WHERE id=$1`,[state.id]);
        if (config.lane === 'political-money') await this.client.query('UPDATE political_money_scores SET cycle_scoped_verified=FALSE WHERE cycle=$1',[config.cycle]);
      }
      return this.load(config);
    });
  }
  async fail(_config,state,code) { await this.client.query('UPDATE money_import_scans SET last_error=$2,updated_at=NOW() WHERE id=$1',[state.id,code]); }
  async restart(config) {
    return this.transaction(async () => {
      await this.client.query(`UPDATE money_import_scans SET status='abandoned',updated_at=NOW() WHERE id=(SELECT active_scan_id FROM money_import_checkpoints WHERE lane=$1 AND cycle=$2 AND scope_key=$3) AND status NOT IN ('completed','no_data')`,[config.lane,config.cycle,config.key]);
      await this.client.query('UPDATE money_import_checkpoints SET active_scan_id=NULL WHERE lane=$1 AND cycle=$2 AND scope_key=$3',[config.lane,config.cycle,config.key]);
    });
  }
}
