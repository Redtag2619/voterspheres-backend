import express from "express";

const router = express.Router();

let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db/pool.js",
    "../db.js",
    "../database.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.pool || mod.default || mod.db || null;
      if (db?.query) {
        cachedDb = db;
        return db;
      }
    } catch {
      // try next
    }
  }

  throw new Error("Database connection not found for workspaces route");
}

async function query(sql, params = []) {
  const db = await getDb();
  return db.query(sql, params);
}

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

function getUserId(req) {
  return req.auth?.userId || req.user?.id || null;
}

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

async function ensureWorkspaceTables() {
  await query(`
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

  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS name TEXT`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug TEXT`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS candidate_name TEXT`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'National'`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS office TEXT DEFAULT 'Statewide'`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cycle TEXT DEFAULT '2026'`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await query(`CREATE INDEX IF NOT EXISTS idx_workspaces_firm_id ON workspaces(firm_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug)`);

  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_firm_id ON tasks(firm_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`);
}

async function ensureReportTables() {
  await ensureWorkspaceTables();

  await query(`
    CREATE TABLE IF NOT EXISTS workspace_reports (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      filename TEXT,
      html TEXT,
      summary JSONB DEFAULT '{}'::jsonb,
      generated_by_user_id INTEGER,
      generated_by_name TEXT,
      generated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS title TEXT`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS filename TEXT`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS html TEXT`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS summary JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS generated_by_user_id INTEGER`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS generated_by_name TEXT`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS generated_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE workspace_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await query(`CREATE INDEX IF NOT EXISTS idx_workspace_reports_firm_workspace ON workspace_reports(firm_id, workspace_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_workspace_reports_generated_at ON workspace_reports(generated_at DESC)`);
}

async function ensureDefaultWorkspace(req) {
  const firmId = getFirmId(req);
  if (!firmId) return null;

  await ensureWorkspaceTables();

  const existing = await query(
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

  const created = await query(
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
      getUserId(req),
      JSON.stringify({ default: true })
    ]
  );

  return created.rows[0];
}

async function requireWorkspaceAccess(req, res) {
  const firmId = getFirmId(req);
  const workspaceId = Number(req.params.id);

  if (!firmId) {
    res.status(401).json({ error: "Missing firm context" });
    return null;
  }

  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return null;
  }

  const result = await query(
    `
      SELECT *
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [workspaceId, firmId]
  );

  const workspace = result.rows[0];

  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return null;
  }

  return { firmId, workspaceId, workspace };
}

router.get("/", async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    await ensureDefaultWorkspace(req);

    const result = await query(
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

    return res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load workspaces" });
  }
});

router.get("/active/default", async (req, res) => {
  try {
    const workspace = await ensureDefaultWorkspace(req);
    if (!workspace) return res.status(401).json({ error: "Missing firm context" });

    return res.json({ ok: true, workspace });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load default workspace" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const taskSummary = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'open')) <> 'complete')::int AS open,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'open')) = 'complete')::int AS complete,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'open')) = 'blocked')::int AS blocked,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(priority, 'medium')) IN ('high','critical'))::int AS high_priority
        FROM tasks
        WHERE firm_id = $1 AND workspace_id = $2
      `,
      [access.firmId, access.workspaceId]
    );

    return res.json({
      ok: true,
      workspace: access.workspace,
      summary: taskSummary.rows[0] || {}
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load workspace" });
  }
});

router.post("/", async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    await ensureWorkspaceTables();

    const name = text(req.body.name || req.body.campaign_name);
    if (!name) return res.status(400).json({ error: "Workspace name is required" });

    const result = await query(
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
        getUserId(req),
        JSON.stringify(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {})
      ]
    );

    return res.status(201).json({
      ok: true,
      workspace: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to create workspace" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const existing = access.workspace;

    const result = await query(
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
        access.workspaceId,
        access.firmId,
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

    return res.json({
      ok: true,
      workspace: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to update workspace" });
  }
});

router.get("/:id/reports", async (req, res) => {
  try {
    await ensureReportTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const result = await query(
      `
        SELECT
          id,
          firm_id,
          workspace_id,
          title,
          filename,
          html,
          summary,
          generated_by_user_id,
          generated_by_name,
          generated_at,
          created_at,
          updated_at
        FROM workspace_reports
        WHERE firm_id = $1 AND workspace_id = $2
        ORDER BY generated_at DESC, id DESC
        LIMIT 50
      `,
      [access.firmId, access.workspaceId]
    );

    return res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load workspace reports" });
  }
});

router.post("/:id/reports", async (req, res) => {
  try {
    await ensureReportTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const title = text(req.body.title) || `${access.workspace.name || "Workspace"} Report`;
    const filename = text(req.body.filename) || null;
    const html = String(req.body.html || "");
    const summary = req.body.summary && typeof req.body.summary === "object" ? req.body.summary : {};
    const generatedByName =
      text(req.body.generated_by) ||
      text(`${req.user?.first_name || ""} ${req.user?.last_name || ""}`) ||
      req.user?.email ||
      "Command Team";

    if (!html) {
      return res.status(400).json({ error: "Report HTML is required" });
    }

    const result = await query(
      `
        INSERT INTO workspace_reports (
          firm_id,
          workspace_id,
          title,
          filename,
          html,
          summary,
          generated_by_user_id,
          generated_by_name,
          generated_at,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,NOW(),NOW(),NOW())
        RETURNING *
      `,
      [
        access.firmId,
        access.workspaceId,
        title,
        filename,
        html,
        JSON.stringify(summary),
        getUserId(req),
        generatedByName
      ]
    );

    return res.status(201).json({
      ok: true,
      report: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save workspace report" });
  }
});

router.delete("/:id/reports", async (req, res) => {
  try {
    await ensureReportTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const result = await query(
      `
        DELETE FROM workspace_reports
        WHERE firm_id = $1 AND workspace_id = $2
        RETURNING id
      `,
      [access.firmId, access.workspaceId]
    );

    return res.json({
      ok: true,
      deleted: result.rowCount || 0
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to clear workspace reports" });
  }
});

router.delete("/:id/reports/:reportId", async (req, res) => {
  try {
    await ensureReportTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const reportId = Number(req.params.reportId);
    if (!Number.isFinite(reportId)) {
      return res.status(400).json({ error: "Invalid report id" });
    }

    const result = await query(
      `
        DELETE FROM workspace_reports
        WHERE id = $1 AND firm_id = $2 AND workspace_id = $3
        RETURNING id
      `,
      [reportId, access.firmId, access.workspaceId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Report not found" });
    }

    return res.json({
      ok: true,
      deleted: result.rows[0].id
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to delete workspace report" });
  }
});

export default router;
