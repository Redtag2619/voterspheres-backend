import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

const VALID_STAGES = [
  "new",
  "qualified",
  "demo_scheduled",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
];

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

function text(value = "") {
  return String(value ?? "").trim();
}

function nullableText(value = "") {
  const clean = text(value);
  return clean ? clean : null;
}

function numberOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function normalizeStage(value = "new") {
  const clean = text(value).toLowerCase();
  return VALID_STAGES.includes(clean) ? clean : "new";
}

function normalizePriority(value = "medium") {
  const clean = text(value).toLowerCase();
  return VALID_PRIORITIES.includes(clean) ? clean : "medium";
}

function getUserId(req) {
  return req.auth?.userId || req.user?.id || null;
}

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

async function ensureEnterpriseLeadTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_leads (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE enterprise_leads
      ADD COLUMN IF NOT EXISTS firm_id INTEGER,
      ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER,
      ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS firm_name TEXT,
      ADD COLUMN IF NOT EXISTS contact_name TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS organization_type TEXT,
      ADD COLUMN IF NOT EXISTS states TEXT[],
      ADD COLUMN IF NOT EXISTS cycle TEXT,
      ADD COLUMN IF NOT EXISTS campaign_count INTEGER,
      ADD COLUMN IF NOT EXISTS team_size INTEGER,
      ADD COLUMN IF NOT EXISTS budget_range TEXT,
      ADD COLUMN IF NOT EXISTS timeline TEXT,
      ADD COLUMN IF NOT EXISTS use_case TEXT,
      ADD COLUMN IF NOT EXISTS message TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'enterprise_intake',
      ADD COLUMN IF NOT EXISTS utm_source TEXT,
      ADD COLUMN IF NOT EXISTS utm_medium TEXT,
      ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
      ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS won_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS lost_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS lost_reason TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE enterprise_leads
    SET
      stage = COALESCE(NULLIF(stage, ''), 'new'),
      priority = COALESCE(NULLIF(priority, ''), 'medium'),
      source = COALESCE(NULLIF(source, ''), 'enterprise_intake'),
      updated_at = COALESCE(updated_at, NOW())
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_lead_notes (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES enterprise_leads(id) ON DELETE CASCADE,
      user_id INTEGER,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS enterprise_leads_stage_idx
      ON enterprise_leads(stage)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS enterprise_leads_email_idx
      ON enterprise_leads(email)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS enterprise_leads_created_at_idx
      ON enterprise_leads(created_at DESC)
  `);
}

function serializeLead(row = {}) {
  return {
    ...row,
    states: Array.isArray(row.states) ? row.states : [],
  };
}

function parseStates(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map(text)
    .filter(Boolean);
}

/**
 * PUBLIC: create enterprise lead
 * POST /api/enterprise-leads
 */
router.post("/", async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const email = text(req.body?.email).toLowerCase();

    if (!email) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    const contactName = nullableText(req.body?.contact_name || req.body?.contactName);
    const firmName = nullableText(req.body?.firm_name || req.body?.firmName);

    const result = await pool.query(
      `
        INSERT INTO enterprise_leads (
          stage,
          priority,
          firm_name,
          contact_name,
          email,
          phone,
          title,
          website,
          organization_type,
          states,
          cycle,
          campaign_count,
          team_size,
          budget_range,
          timeline,
          use_case,
          message,
          source,
          utm_source,
          utm_medium,
          utm_campaign,
          created_at,
          updated_at
        )
        VALUES (
          'new',
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::text[],
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          NOW(),
          NOW()
        )
        RETURNING *
      `,
      [
        normalizePriority(req.body?.priority || "high"),
        firmName,
        contactName,
        email,
        nullableText(req.body?.phone),
        nullableText(req.body?.title),
        nullableText(req.body?.website),
        nullableText(req.body?.organization_type || req.body?.organizationType),
        parseStates(req.body?.states),
        nullableText(req.body?.cycle),
        numberOrNull(req.body?.campaign_count || req.body?.campaignCount),
        numberOrNull(req.body?.team_size || req.body?.teamSize),
        nullableText(req.body?.budget_range || req.body?.budgetRange),
        nullableText(req.body?.timeline),
        nullableText(req.body?.use_case || req.body?.useCase),
        nullableText(req.body?.message),
        nullableText(req.body?.source) || "enterprise_intake",
        nullableText(req.body?.utm_source || req.body?.utmSource),
        nullableText(req.body?.utm_medium || req.body?.utmMedium),
        nullableText(req.body?.utm_campaign || req.body?.utmCampaign),
      ]
    );

    return res.status(201).json({
      ok: true,
      lead: serializeLead(result.rows[0]),
      message: "Enterprise inquiry received.",
    });
  } catch (error) {
    console.error("Enterprise lead create error:", error);

    return res.status(500).json({
      error: error.message || "Failed to create enterprise lead",
    });
  }
});

/**
 * ADMIN: list enterprise leads
 * GET /api/enterprise-leads/admin
 */
router.get("/admin", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const stage = text(req.query?.stage);
    const priority = text(req.query?.priority);
    const q = text(req.query?.q);
    const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 250);

    const conditions = [];
    const values = [];
    let idx = 1;

    if (stage && stage !== "all") {
      conditions.push(`stage = $${idx++}`);
      values.push(normalizeStage(stage));
    }

    if (priority && priority !== "all") {
      conditions.push(`priority = $${idx++}`);
      values.push(normalizePriority(priority));
    }

    if (q) {
      conditions.push(`
        (
          firm_name ILIKE $${idx}
          OR contact_name ILIKE $${idx}
          OR email ILIKE $${idx}
          OR organization_type ILIKE $${idx}
          OR use_case ILIKE $${idx}
        )
      `);
      values.push(`%${q}%`);
      idx += 1;
    }

    values.push(limit);

    const result = await pool.query(
      `
        SELECT *
        FROM enterprise_leads
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY
          CASE priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            ELSE 4
          END,
          created_at DESC
        LIMIT $${idx}
      `,
      values
    );

    const summary = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE stage = 'new')::int AS new_count,
        COUNT(*) FILTER (WHERE stage = 'qualified')::int AS qualified_count,
        COUNT(*) FILTER (WHERE stage = 'demo_scheduled')::int AS demo_scheduled_count,
        COUNT(*) FILTER (WHERE stage = 'proposal_sent')::int AS proposal_sent_count,
        COUNT(*) FILTER (WHERE stage = 'won')::int AS won_count,
        COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost_count,
        COUNT(*) FILTER (WHERE priority IN ('high', 'urgent'))::int AS high_priority_count
      FROM enterprise_leads
    `);

    return res.json({
      ok: true,
      results: result.rows.map(serializeLead),
      summary: summary.rows[0] || {},
      stages: VALID_STAGES,
      priorities: VALID_PRIORITIES,
    });
  } catch (error) {
    console.error("Enterprise lead list error:", error);

    return res.status(500).json({
      error: error.message || "Failed to load enterprise leads",
    });
  }
});

/**
 * ADMIN: get one lead
 * GET /api/enterprise-leads/admin/:id
 */
router.get("/admin/:id", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const leadResult = await pool.query(
      `
        SELECT *
        FROM enterprise_leads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const lead = leadResult.rows[0];

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const notesResult = await pool.query(
      `
        SELECT *
        FROM enterprise_lead_notes
        WHERE lead_id = $1
        ORDER BY created_at DESC
      `,
      [id]
    );

    return res.json({
      ok: true,
      lead: serializeLead(lead),
      notes: notesResult.rows,
    });
  } catch (error) {
    console.error("Enterprise lead detail error:", error);

    return res.status(500).json({
      error: error.message || "Failed to load enterprise lead",
    });
  }
});

/**
 * ADMIN: update lead
 * PATCH /api/enterprise-leads/admin/:id
 */
router.patch("/admin/:id", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const stage = req.body?.stage === undefined ? null : normalizeStage(req.body.stage);
    const priority =
      req.body?.priority === undefined ? null : normalizePriority(req.body.priority);

    const result = await pool.query(
      `
        UPDATE enterprise_leads
        SET
          stage = COALESCE($2, stage),
          priority = COALESCE($3, priority),
          assigned_user_id = COALESCE($4, assigned_user_id),
          firm_id = COALESCE($5, firm_id),
          firm_name = COALESCE($6, firm_name),
          contact_name = COALESCE($7, contact_name),
          email = COALESCE($8, email),
          phone = COALESCE($9, phone),
          title = COALESCE($10, title),
          website = COALESCE($11, website),
          organization_type = COALESCE($12, organization_type),
          states = COALESCE($13::text[], states),
          cycle = COALESCE($14, cycle),
          campaign_count = COALESCE($15, campaign_count),
          team_size = COALESCE($16, team_size),
          budget_range = COALESCE($17, budget_range),
          timeline = COALESCE($18, timeline),
          use_case = COALESCE($19, use_case),
          message = COALESCE($20, message),
          next_follow_up_at = COALESCE($21, next_follow_up_at),
          last_contacted_at = COALESCE($22, last_contacted_at),
          lost_reason = COALESCE($23, lost_reason),
          won_at = CASE WHEN $2 = 'won' THEN COALESCE(won_at, NOW()) ELSE won_at END,
          lost_at = CASE WHEN $2 = 'lost' THEN COALESCE(lost_at, NOW()) ELSE lost_at END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        stage,
        priority,
        req.body?.assigned_user_id === undefined
          ? null
          : numberOrNull(req.body.assigned_user_id),
        req.body?.firm_id === undefined ? null : numberOrNull(req.body.firm_id),
        req.body?.firm_name === undefined ? null : nullableText(req.body.firm_name),
        req.body?.contact_name === undefined ? null : nullableText(req.body.contact_name),
        req.body?.email === undefined ? null : text(req.body.email).toLowerCase(),
        req.body?.phone === undefined ? null : nullableText(req.body.phone),
        req.body?.title === undefined ? null : nullableText(req.body.title),
        req.body?.website === undefined ? null : nullableText(req.body.website),
        req.body?.organization_type === undefined
          ? null
          : nullableText(req.body.organization_type),
        req.body?.states === undefined ? null : parseStates(req.body.states),
        req.body?.cycle === undefined ? null : nullableText(req.body.cycle),
        req.body?.campaign_count === undefined
          ? null
          : numberOrNull(req.body.campaign_count),
        req.body?.team_size === undefined ? null : numberOrNull(req.body.team_size),
        req.body?.budget_range === undefined ? null : nullableText(req.body.budget_range),
        req.body?.timeline === undefined ? null : nullableText(req.body.timeline),
        req.body?.use_case === undefined ? null : nullableText(req.body.use_case),
        req.body?.message === undefined ? null : nullableText(req.body.message),
        req.body?.next_follow_up_at === undefined
          ? null
          : nullableText(req.body.next_follow_up_at),
        req.body?.last_contacted_at === undefined
          ? null
          : nullableText(req.body.last_contacted_at),
        req.body?.lost_reason === undefined ? null : nullableText(req.body.lost_reason),
      ]
    );

    const lead = result.rows[0];

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({
      ok: true,
      lead: serializeLead(lead),
    });
  } catch (error) {
    console.error("Enterprise lead update error:", error);

    return res.status(500).json({
      error: error.message || "Failed to update enterprise lead",
    });
  }
});

/**
 * ADMIN: add lead note
 * POST /api/enterprise-leads/admin/:id/notes
 */
router.post("/admin/:id/notes", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const id = Number(req.params.id);
    const note = text(req.body?.note);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    if (!note) {
      return res.status(400).json({ error: "Note is required" });
    }

    const leadCheck = await pool.query(
      `
        SELECT id
        FROM enterprise_leads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (!leadCheck.rows[0]) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const result = await pool.query(
      `
        INSERT INTO enterprise_lead_notes (
          lead_id,
          user_id,
          note,
          created_at
        )
        VALUES ($1,$2,$3,NOW())
        RETURNING *
      `,
      [id, getUserId(req), note]
    );

    await pool.query(
      `
        UPDATE enterprise_leads
        SET updated_at = NOW()
        WHERE id = $1
      `,
      [id]
    );

    return res.status(201).json({
      ok: true,
      note: result.rows[0],
    });
  } catch (error) {
    console.error("Enterprise lead note error:", error);

    return res.status(500).json({
      error: error.message || "Failed to add note",
    });
  }
});

/**
 * ADMIN: delete lead
 * DELETE /api/enterprise-leads/admin/:id
 */
router.delete("/admin/:id", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const result = await pool.query(
      `
        DELETE FROM enterprise_leads
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({
      ok: true,
      deleted: result.rows[0].id,
    });
  } catch (error) {
    console.error("Enterprise lead delete error:", error);

    return res.status(500).json({
      error: error.message || "Failed to delete enterprise lead",
    });
  }
});

export default router;
