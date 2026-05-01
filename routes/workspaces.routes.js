import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

function text(value = "") {
  return String(value ?? "").trim();
}

function slugify(value = "") {
  return text(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

async function ensureWorkspaceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT,
      candidate_name TEXT,
      state TEXT DEFAULT 'National',
      office TEXT DEFAULT 'Statewide',
      cycle TEXT DEFAULT '2026',
      status TEXT DEFAULT 'active',
      description TEXT,
      created_by_user_id INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const columns = [
    ["firm_id", "INTEGER"],
    ["name", "TEXT"],
    ["slug", "TEXT"],
    ["candidate_name", "TEXT"],
    ["state", "TEXT DEFAULT 'National'"],
    ["office", "TEXT DEFAULT 'Statewide'"],
    ["cycle", "TEXT DEFAULT '2026'"],
    ["status", "TEXT DEFAULT 'active'"],
    ["description", "TEXT"],
    ["created_by_user_id", "INTEGER"],
    ["metadata", "JSONB DEFAULT '{}'::jsonb"],
    ["created_at", "TIMESTAMP DEFAULT NOW()"],
    ["updated_at", "TIMESTAMP DEFAULT NOW()"]
  ];

  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workspaces_firm_id ON workspaces(firm_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug)`);

  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_firm_id ON tasks(firm_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`);
}

async function ensureDefaultWorkspace(req) {
  const firmId = getFirmId(req);
  if (!firmId) return null;

  await ensureWorkspaceTables();

  const existing = await pool.query(
    `
    SELECT *
    FROM workspaces
    WHERE firm_id = $1
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    `,
    [firmId]
  );

  if (existing.rows[0]) return existing.rows[0];

  const name = req.user?.firm_name || "Default Campaign Workspace";

  const created = await pool.query(
    `
    INSERT INTO workspaces (
      firm_id,
      name,
      slug,
      status,
      created_by_user_id,
      metadata,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,'active',$4,$5::jsonb,NOW(),NOW())
    RETURNING *
    `,
    [
      firmId,
      name,
      slugify(name),
      req.auth?.userId || req.user?.id || null,
      JSON.stringify({ default: true })
    ]
  );

  return created.rows[0];
}

router.get("/", async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    await ensureDefaultWorkspace(req);

    const result = await pool.query(
      `
      SELECT
        w.*,
        COUNT(t.id)::int AS task_count,
        COUNT(t.id) FILTER (WHERE LOWER(COALESCE(t.status, 'open')) <> 'complete')::int AS open_task_count,
        COUNT(t.id) FILTER (WHERE LOWER(COALESCE(t.status, 'open')) = 'complete')::int AS complete_task_count
      FROM workspaces w
      LEFT JOIN tasks t
        ON t.workspace_id = w.id
       AND COALESCE(t.firm_id, w.firm_id) = w.firm_id
      WHERE w.firm_id = $1
      GROUP BY w.id
      ORDER BY
        CASE LOWER(COALESCE(w.status, 'active')) WHEN 'active' THEN 0 ELSE 1 END,
        w.created_at DESC
      `,
      [firmId]
    );

    res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load workspaces" });
  }
});

router.get("/active/default", async (req, res) => {
  try {
    const workspace = await ensureDefaultWorkspace(req);
    if (!workspace) return res.status(401).json({ error: "Missing firm context" });

    res.json({ ok: true, workspace });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load default workspace" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const firmId = getFirmId(req);
    const id = Number(req.params.id);

    if (!firmId) return res.status(401).json({ error: "Missing firm context" });
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid workspace id" });

    await ensureWorkspaceTables();

    const result = await pool.query(
      `
      SELECT *
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
      `,
      [id, firmId]
    );

    const workspace = result.rows[0];
    if (!workspace) return res.status(404).json({ error: "Workspace not found" });

    const taskSummary = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'open')) <> 'complete')::int AS open,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'open')) = 'complete')::int AS complete,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(priority, 'medium')) IN ('high','critical'))::int AS high_priority
      FROM tasks
      WHERE firm_id = $1 AND workspace_id = $2
      `,
      [firmId, id]
    );

    res.json({
      ok: true,
      workspace,
      summary: taskSummary.rows[0] || {}
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load workspace" });
  }
});

router.post("/", async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    await ensureWorkspaceTables();

    const name = text(req.body.name || req.body.campaign_name);
    if (!name) return res.status(400).json({ error: "Workspace name is required" });

    const result = await pool.query(
      `
      INSERT INTO workspaces (
        firm_id,
        name,
        slug,
        candidate_name,
        state,
        office,
        cycle,
        status,
        description,
        created_by_user_id,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
      RETURNING *
      `,
      [
        firmId,
        name,
        slugify(name),
        text(req.body.candidate_name) || null,
        text(req.body.state) || "National",
        text(req.body.office) || "Statewide",
        text(req.body.cycle) || "2026",
        text(req.body.status) || "active",
        text(req.body.description) || null,
        req.auth?.userId || req.user?.id || null,
        JSON.stringify(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {})
      ]
    );

    res.status(201).json({
      ok: true,
      workspace: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create workspace" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const firmId = getFirmId(req);
    const id = Number(req.params.id);

    if (!firmId) return res.status(401).json({ error: "Missing firm context" });
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid workspace id" });

    await ensureWorkspaceTables();

    const current = await pool.query(
      `SELECT * FROM workspaces WHERE id = $1 AND firm_id = $2 LIMIT 1`,
      [id, firmId]
    );

    if (!current.rows[0]) return res.status(404).json({ error: "Workspace not found" });

    const existing = current.rows[0];

    const result = await pool.query(
      `
      UPDATE workspaces
      SET
        name = $3,
        slug = $4,
        candidate_name = $5,
        state = $6,
        office = $7,
        cycle = $8,
        status = $9,
        description = $10,
        metadata = $11::jsonb,
        updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
      RETURNING *
      `,
      [
        id,
        firmId,
        text(req.body.name) || existing.name,
        text(req.body.name) ? slugify(req.body.name) : existing.slug,
        req.body.candidate_name === undefined ? existing.candidate_name : text(req.body.candidate_name),
        req.body.state === undefined ? existing.state : text(req.body.state) || "National",
        req.body.office === undefined ? existing.office : text(req.body.office) || "Statewide",
        req.body.cycle === undefined ? existing.cycle : text(req.body.cycle) || "2026",
        req.body.status === undefined ? existing.status : text(req.body.status) || "active",
        req.body.description === undefined ? existing.description : text(req.body.description),
        JSON.stringify({
          ...(existing.metadata || {}),
          ...(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {})
        })
      ]
    );

    res.json({
      ok: true,
      workspace: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update workspace" });
  }
});

export default router;
