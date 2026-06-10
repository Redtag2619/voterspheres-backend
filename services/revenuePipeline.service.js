import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function clean(value = "") {
  return String(value || "").trim();
}

function number(value = 0) {
  return Number(value || 0);
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[revenue-pipeline] skipped query:", error.message);
    return [];
  }
}

export async function ensureRevenuePipelineTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS revenue_pipeline_deals (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      organization TEXT,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      state TEXT,
      party TEXT,
      office TEXT,
      source TEXT DEFAULT 'manual',
      stage TEXT DEFAULT 'lead',
      value NUMERIC DEFAULT 0,
      probability INTEGER DEFAULT 10,
      expected_close_date DATE,
      next_step TEXT,
      notes TEXT,
      candidate_id INTEGER,
      crm_contact_id INTEGER,
      client_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_revenue_pipeline_deals_firm_id
    ON revenue_pipeline_deals(firm_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_revenue_pipeline_deals_stage
    ON revenue_pipeline_deals(stage)
  `);
}

function normalizeStage(value = "") {
  const v = String(value || "").toLowerCase().replace(/\s+/g, "_");

  if (["lead", "prospect", "qualified", "proposal", "won", "lost"].includes(v)) {
    return v;
  }

  return "lead";
}

function stageProbability(stage) {
  const map = {
    lead: 10,
    prospect: 25,
    qualified: 45,
    proposal: 70,
    won: 100,
    lost: 0,
  };

  return map[normalizeStage(stage)] ?? 10;
}

function stageLabel(stage) {
  const map = {
    lead: "Lead",
    prospect: "Prospect",
    qualified: "Qualified",
    proposal: "Proposal",
    won: "Won",
    lost: "Lost",
  };

  return map[normalizeStage(stage)] || "Lead";
}

function dealRisk(deal = {}) {
  const stage = normalizeStage(deal.stage);
  if (stage === "lost") return "closed";
  if (stage === "won") return "won";
  if (!deal.next_step) return "needs_next_step";
  if (!deal.expected_close_date) return "needs_close_date";
  return "active";
}

function weightedValue(deal = {}) {
  return Math.round(number(deal.value) * (number(deal.probability) / 100));
}

export async function getRevenuePipeline({ user = {}, stage = "", state = "", q = "" }) {
  await ensureRevenuePipelineTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const filters = ["firm_id = $1"];
  const params = [firmId];
  let index = 2;

  if (stage) {
    filters.push(`stage = $${index}`);
    params.push(normalizeStage(stage));
    index += 1;
  }

  if (state) {
    filters.push(`COALESCE(state, '') ILIKE $${index}`);
    params.push(`%${state}%`);
    index += 1;
  }

  if (q) {
    filters.push(`(
      title ILIKE $${index}
      OR COALESCE(organization, '') ILIKE $${index}
      OR COALESCE(contact_name, '') ILIKE $${index}
      OR COALESCE(state, '') ILIKE $${index}
      OR COALESCE(office, '') ILIKE $${index}
      OR COALESCE(party, '') ILIKE $${index}
      OR COALESCE(source, '') ILIKE $${index}
    )`);
    params.push(`%${q}%`);
    index += 1;
  }

  const rows = await safeQuery(
    `
      SELECT *
      FROM revenue_pipeline_deals
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE stage
          WHEN 'proposal' THEN 1
          WHEN 'qualified' THEN 2
          WHEN 'prospect' THEN 3
          WHEN 'lead' THEN 4
          WHEN 'won' THEN 5
          WHEN 'lost' THEN 6
          ELSE 7
        END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
      LIMIT 250
    `,
    params
  );

  const deals = rows.map((deal) => ({
    ...deal,
    stage: normalizeStage(deal.stage),
    stage_label: stageLabel(deal.stage),
    value: number(deal.value),
    probability: number(deal.probability),
    weighted_value: weightedValue(deal),
    risk: dealRisk(deal),
  }));

  const stages = ["lead", "prospect", "qualified", "proposal", "won", "lost"].map((stageKey) => {
    const stageDeals = deals.filter((deal) => normalizeStage(deal.stage) === stageKey);

    return {
      key: stageKey,
      label: stageLabel(stageKey),
      count: stageDeals.length,
      value: stageDeals.reduce((sum, deal) => sum + number(deal.value), 0),
      weighted_value: stageDeals.reduce((sum, deal) => sum + number(deal.weighted_value), 0),
    };
  });

  const openDeals = deals.filter((deal) => !["won", "lost"].includes(normalizeStage(deal.stage)));
  const wonDeals = deals.filter((deal) => normalizeStage(deal.stage) === "won");
  const lostDeals = deals.filter((deal) => normalizeStage(deal.stage) === "lost");

  return {
    summary: {
      total: deals.length,
      open: openDeals.length,
      won: wonDeals.length,
      lost: lostDeals.length,
      pipeline_value: openDeals.reduce((sum, deal) => sum + number(deal.value), 0),
      weighted_pipeline: openDeals.reduce((sum, deal) => sum + number(deal.weighted_value), 0),
      won_value: wonDeals.reduce((sum, deal) => sum + number(deal.value), 0),
      needs_next_step: deals.filter((deal) => deal.risk === "needs_next_step").length,
      proposals: deals.filter((deal) => normalizeStage(deal.stage) === "proposal").length,
    },
    stages,
    deals,
    filters: { stage, state, q },
    updated_at: new Date().toISOString(),
  };
}

export async function createRevenueDeal({ user = {}, payload = {} }) {
  await ensureRevenuePipelineTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const title = clean(payload.title || payload.candidate_name || payload.organization);
  if (!title) throw new Error("Deal title is required.");

  const stage = normalizeStage(payload.stage || "lead");
  const probability =
    payload.probability === undefined || payload.probability === null || payload.probability === ""
      ? stageProbability(stage)
      : number(payload.probability);

  const inserted = await pool.query(
    `
      INSERT INTO revenue_pipeline_deals (
        firm_id,
        title,
        organization,
        contact_name,
        email,
        phone,
        state,
        party,
        office,
        source,
        stage,
        value,
        probability,
        expected_close_date,
        next_step,
        notes,
        candidate_id,
        crm_contact_id,
        client_id,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      title,
      clean(payload.organization),
      clean(payload.contact_name),
      clean(payload.email),
      clean(payload.phone),
      clean(payload.state),
      clean(payload.party),
      clean(payload.office),
      clean(payload.source || "manual"),
      stage,
      number(payload.value),
      probability,
      payload.expected_close_date || null,
      clean(payload.next_step),
      clean(payload.notes),
      payload.candidate_id || null,
      payload.crm_contact_id || null,
      payload.client_id || null,
    ]
  );

  return {
    deal: inserted.rows[0],
    message: "Revenue pipeline deal created.",
  };
}

export async function updateRevenueDeal({ user = {}, id, payload = {} }) {
  await ensureRevenuePipelineTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");
  if (!id) throw new Error("Deal id is required.");

  const current = await safeQuery(
    `
      SELECT *
      FROM revenue_pipeline_deals
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [id, firmId]
  );

  if (!current[0]) throw new Error("Deal not found.");

  const next = {
    ...current[0],
    ...payload,
  };

  const stage = normalizeStage(next.stage);
  const probability =
    payload.probability === undefined || payload.probability === null || payload.probability === ""
      ? stageProbability(stage)
      : number(payload.probability);

  const updated = await pool.query(
    `
      UPDATE revenue_pipeline_deals
      SET
        title = $1,
        organization = $2,
        contact_name = $3,
        email = $4,
        phone = $5,
        state = $6,
        party = $7,
        office = $8,
        source = $9,
        stage = $10,
        value = $11,
        probability = $12,
        expected_close_date = $13,
        next_step = $14,
        notes = $15,
        candidate_id = $16,
        crm_contact_id = $17,
        client_id = $18,
        updated_at = NOW()
      WHERE id = $19 AND firm_id = $20
      RETURNING *
    `,
    [
      clean(next.title),
      clean(next.organization),
      clean(next.contact_name),
      clean(next.email),
      clean(next.phone),
      clean(next.state),
      clean(next.party),
      clean(next.office),
      clean(next.source || "manual"),
      stage,
      number(next.value),
      probability,
      next.expected_close_date || null,
      clean(next.next_step),
      clean(next.notes),
      next.candidate_id || null,
      next.crm_contact_id || null,
      next.client_id || null,
      id,
      firmId,
    ]
  );

  return {
    deal: updated.rows[0],
    message: "Revenue pipeline deal updated.",
  };
}

export async function advanceRevenueDeal({ user = {}, id, stage = "" }) {
  return updateRevenueDeal({
    user,
    id,
    payload: {
      stage: normalizeStage(stage),
      probability: stageProbability(stage),
    },
  });
}

export async function deleteRevenueDeal({ user = {}, id }) {
  await ensureRevenuePipelineTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");
  if (!id) throw new Error("Deal id is required.");

  await pool.query(
    `
      DELETE FROM revenue_pipeline_deals
      WHERE id = $1 AND firm_id = $2
    `,
    [id, firmId]
  );

  return { message: "Revenue pipeline deal deleted." };
}

export async function createDealFromOpportunity({ user = {}, opportunity = {} }) {
  return createRevenueDeal({
    user,
    payload: {
      title: opportunity.candidate_name || opportunity.title || "Campaign Opportunity",
      organization: opportunity.office || "Campaign",
      contact_name: opportunity.candidate_name || "",
      email: opportunity.email || "",
      phone: opportunity.phone || "",
      state: opportunity.state || "",
      party: opportunity.party || "",
      office: opportunity.office || "",
      source: "opportunity_engine",
      stage: number(opportunity.score) >= 85 ? "qualified" : "prospect",
      value: opportunity.value || 25000,
      probability: number(opportunity.score) >= 85 ? 45 : 25,
      next_step: opportunity.recommended_action || "Assign consultant follow-up.",
      notes: `Created from Opportunity Engine. Score: ${opportunity.score || 0}.`,
      candidate_id: opportunity.candidate_id || opportunity.id || null,
    },
  });
}
