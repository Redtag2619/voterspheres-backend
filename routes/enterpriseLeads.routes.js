import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { provisionEnterpriseLeadWorkspace } from "../services/enterpriseProvisioning.service.js";

const router = express.Router();

const VALID_STAGES = [
  "new",
  "contacted",
  "qualified",
  "demo_scheduled",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
  "archived",
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

function parseStates(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);

  return String(value || "")
    .split(",")
    .map(text)
    .filter(Boolean);
}

function serializeLead(row = {}) {
  return {
    ...row,
    stage: row.stage ? String(row.stage) : row.status ? String(row.status) : "new",
    status: row.status ? String(row.status) : row.stage ? String(row.stage) : "new",
    states: Array.isArray(row.states) ? row.states : [],
  };
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
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS firm_name TEXT,
      ADD COLUMN IF NOT EXISTS full_name TEXT,
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
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'enterprise_intake',
      ADD COLUMN IF NOT EXISTS utm_source TEXT,
      ADD COLUMN IF NOT EXISTS utm_medium TEXT,
      ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
      ADD COLUMN IF NOT EXISTS is_beta_approved BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS has_pending_invite BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS has_converted_user BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS invite_link TEXT,
      ADD COLUMN IF NOT EXISTS review_notes TEXT,
      ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS won_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS lost_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS lost_reason TEXT,
      ADD COLUMN IF NOT EXISTS provisioned_workspace_id INTEGER,
      ADD COLUMN IF NOT EXISTS provisioned_workspace_table TEXT,
      ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS provisioning_status TEXT DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS provisioning_notes TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE enterprise_leads
      ALTER COLUMN full_name DROP NOT NULL,
      ALTER COLUMN contact_name DROP NOT NULL,
      ALTER COLUMN firm_name DROP NOT NULL,
      ALTER COLUMN email DROP NOT NULL,
      ALTER COLUMN phone DROP NOT NULL,
      ALTER COLUMN message DROP NOT NULL,
      ALTER COLUMN notes DROP NOT NULL,
      ALTER COLUMN team_size DROP NOT NULL,
      ALTER COLUMN stage DROP NOT NULL,
      ALTER COLUMN status DROP NOT NULL,
      ALTER COLUMN priority DROP NOT NULL,
      ALTER COLUMN source DROP NOT NULL
  `);

  await pool.query(`
    UPDATE enterprise_leads
    SET
      stage = COALESCE(NULLIF(stage::text, ''), NULLIF(status::text, ''), 'new'),
      status = COALESCE(NULLIF(status::text, ''), NULLIF(stage::text, ''), 'new'),
      priority = COALESCE(NULLIF(priority::text, ''), 'medium'),
      source = COALESCE(NULLIF(source::text, ''), 'enterprise_intake'),
      full_name = COALESCE(full_name, contact_name, email, firm_name, 'Unknown Lead'),
      contact_name = COALESCE(contact_name, full_name, email, firm_name, 'Unknown Lead'),
      firm_name = COALESCE(firm_name, 'Enterprise Prospect'),
      team_size = COALESCE(team_size, 1),
      message = COALESCE(message, use_case, notes, 'Enterprise intake request'),
      notes = COALESCE(notes, message, use_case, 'Enterprise intake request'),
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
    CREATE INDEX IF NOT EXISTS enterprise_leads_status_idx
      ON enterprise_leads(status)
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

router.post("/", async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const body = req.body || {};
    const email = text(body.email).toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const contactName =
      nullableText(body.contact_name || body.contactName) ||
      nullableText(body.full_name || body.fullName) ||
      email;

    const firmName =
      nullableText(body.firm_name || body.firmName) ||
      "Enterprise Prospect";

    const result = await pool.query(
      `
        INSERT INTO enterprise_leads (
          stage,
          status,
          priority,
          firm_name,
          full_name,
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
          notes,
          source,
          utm_source,
          utm_medium,
          utm_campaign,
          created_at,
          updated_at
        )
        VALUES (
          'new',
          'new',
          $1,
          $2,
          $3,
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
        normalizePriority(body.priority || "high"),
        firmName,
        contactName,
        email,
        nullableText(body.phone),
        nullableText(body.title),
        nullableText(body.website),
        nullableText(body.organization_type || body.organizationType),
        parseStates(body.states),
        nullableText(body.cycle),
        numberOrNull(body.campaign_count || body.campaignCount),
        numberOrNull(body.team_size || body.teamSize) || 1,
        nullableText(body.budget_range || body.budgetRange),
        nullableText(body.timeline),
        nullableText(body.use_case || body.useCase),
        nullableText(body.message) || "Enterprise intake request",
        nullableText(body.source) || "enterprise_intake",
        nullableText(body.utm_source || body.utmSource),
        nullableText(body.utm_medium || body.utmMedium),
        nullableText(body.utm_campaign || body.utmCampaign),
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

router.get("/admin", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const stage = text(req.query?.stage || req.query?.status);
    const priority = text(req.query?.priority);
    const q = text(req.query?.q);
    const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 250);

    const conditions = [];
    const values = [];
    let idx = 1;

    if (stage && stage !== "all") {
      conditions.push(`stage::text = $${idx++}`);
      values.push(normalizeStage(stage));
    }

    if (priority && priority !== "all") {
      conditions.push(`priority::text = $${idx++}`);
      values.push(normalizePriority(priority));
    }

    if (q) {
      conditions.push(`
        (
          firm_name ILIKE $${idx}
          OR full_name ILIKE $${idx}
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
        SELECT
          id,
          created_at,
          updated_at,
          stage::text AS stage,
          status::text AS status,
          priority::text AS priority,
          firm_name,
          full_name,
          contact_name,
          email,
          phone,
          states,
          budget_range,
          use_case,
          message,
          source,
          provisioned_workspace_id,
          provisioning_status
        FROM enterprise_leads
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY created_at DESC
        LIMIT $${idx}
      `,
      values
    );

    const summary = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE stage::text = 'new')::int AS new_count,
        COUNT(*) FILTER (WHERE stage::text = 'qualified')::int AS qualified_count,
        COUNT(*) FILTER (WHERE stage::text = 'demo_scheduled')::int AS demo_scheduled_count,
        COUNT(*) FILTER (WHERE stage::text = 'proposal_sent')::int AS proposal_sent_count,
        COUNT(*) FILTER (WHERE stage::text = 'won')::int AS won_count,
        COUNT(*) FILTER (WHERE stage::text IN ('lost', 'archived'))::int AS lost_count,
        COUNT(*) FILTER (WHERE priority::text IN ('high', 'urgent'))::int AS high_priority_count,
        COUNT(*) FILTER (WHERE provisioned_workspace_id IS NOT NULL)::int AS provisioned_count
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

router.patch("/admin/:id", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const requestedStage =
      req.body?.stage === undefined && req.body?.status === undefined
        ? null
        : normalizeStage(req.body?.stage || req.body?.status);

    const priority =
      req.body?.priority === undefined ? null : normalizePriority(req.body.priority);

    const result = await pool.query(
      `
        UPDATE enterprise_leads
        SET
          stage = COALESCE($2, stage),
          status = COALESCE($2, status),
          priority = COALESCE($3, priority),
          assigned_user_id = COALESCE($4, assigned_user_id),
          firm_id = COALESCE($5, firm_id),
          firm_name = COALESCE($6, firm_name),
          full_name = COALESCE($7, full_name),
          contact_name = COALESCE($8, contact_name),
          email = COALESCE($9, email),
          phone = COALESCE($10, phone),
          title = COALESCE($11, title),
          website = COALESCE($12, website),
          organization_type = COALESCE($13, organization_type),
          states = COALESCE($14::text[], states),
          cycle = COALESCE($15, cycle),
          campaign_count = COALESCE($16, campaign_count),
          team_size = COALESCE($17, team_size),
          budget_range = COALESCE($18, budget_range),
          timeline = COALESCE($19, timeline),
          use_case = COALESCE($20, use_case),
          message = COALESCE($21, message),
          notes = COALESCE($22, notes),
          next_follow_up_at = COALESCE($23, next_follow_up_at),
          last_contacted_at = COALESCE($24, last_contacted_at),
          lost_reason = COALESCE($25, lost_reason),
          review_notes = COALESCE($26, review_notes),
          won_at = CASE WHEN $2 = 'won' THEN COALESCE(won_at, NOW()) ELSE won_at END,
          lost_at = CASE WHEN $2 IN ('lost', 'archived') THEN COALESCE(lost_at, NOW()) ELSE lost_at END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        requestedStage,
        priority,
        req.body?.assigned_user_id === undefined
          ? null
          : numberOrNull(req.body.assigned_user_id),
        req.body?.firm_id === undefined ? null : numberOrNull(req.body.firm_id),
        req.body?.firm_name === undefined ? null : nullableText(req.body.firm_name),
        req.body?.full_name === undefined ? null : nullableText(req.body.full_name),
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
        req.body?.notes === undefined ? null : nullableText(req.body.notes),
        req.body?.next_follow_up_at === undefined
          ? null
          : nullableText(req.body.next_follow_up_at),
        req.body?.last_contacted_at === undefined
          ? null
          : nullableText(req.body.last_contacted_at),
        req.body?.lost_reason === undefined ? null : nullableText(req.body.lost_reason),
        req.body?.review_notes === undefined ? null : nullableText(req.body.review_notes),
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

router.post("/admin/:id/approve", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const result = await pool.query(
      `
        UPDATE enterprise_leads
        SET
          is_beta_approved = true,
          stage = CASE WHEN stage::text = 'new' THEN 'qualified' ELSE stage END,
          status = CASE WHEN status::text = 'new' THEN 'qualified' ELSE status END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [Number(req.params.id)]
    );

    return res.json({
      ok: true,
      lead: serializeLead(result.rows[0]),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve lead",
    });
  }
});

router.post("/admin/:id/invite", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const inviteLink = `${process.env.FRONTEND_URL || "https://www.voterspheres.org"}/signup?invite=enterprise-${req.params.id}`;

    const result = await pool.query(
      `
        UPDATE enterprise_leads
        SET
          has_pending_invite = true,
          invite_link = $2,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [Number(req.params.id), inviteLink]
    );

    return res.json({
      ok: true,
      email_sent: false,
      invite_link: inviteLink,
      lead: serializeLead(result.rows[0]),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to invite lead",
    });
  }
});

router.post("/admin/:id/approve-and-invite", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const inviteLink = `${process.env.FRONTEND_URL || "https://www.voterspheres.org"}/signup?invite=enterprise-${req.params.id}`;

    const result = await pool.query(
      `
        UPDATE enterprise_leads
        SET
          is_beta_approved = true,
          has_pending_invite = true,
          invite_link = $2,
          stage = CASE WHEN stage::text = 'new' THEN 'qualified' ELSE stage END,
          status = CASE WHEN status::text = 'new' THEN 'qualified' ELSE status END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [Number(req.params.id), inviteLink]
    );

    return res.json({
      ok: true,
      email_sent: false,
      invite_link: inviteLink,
      lead: serializeLead(result.rows[0]),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve and invite lead",
    });
  }
});

router.post("/admin/:id/provision-workspace", requireAuth, async (req, res) => {
  try {
    await ensureEnterpriseLeadTables();

    const leadId = Number(req.params.id);

    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const result = await provisionEnterpriseLeadWorkspace({
      leadId,
      userId: getUserId(req),
      firmId: getFirmId(req),
    });

    return res.json({
      ok: true,
      ...result,
      lead: serializeLead(result.lead || {}),
    });
  } catch (error) {
    console.error("Enterprise workspace provisioning error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to provision workspace",
    });
  }
});

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
