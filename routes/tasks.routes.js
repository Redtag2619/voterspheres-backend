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
    "../database.js",
    "../lib/database.js",
    "../lib/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.default || mod.db || mod.pool || mod.client || null;
      if (db?.query) {
        cachedDb = db;
        return db;
      }
    } catch {
      // try next
    }
  }

  throw new Error("Database connection not available for tasks route.");
}

async function query(sql, params = []) {
  const db = await getDb();
  return db.query(sql, params);
}

function asText(value = "") {
  return String(value || "").trim();
}

function isVendorTaskSource(source = "") {
  return ["vendor_network", "vendor_intelligence"].includes(asText(source));
}

function getVendorActionId(metadata = {}) {
  return asText(metadata?.vendor_action_id);
}

async function ensureTasksTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      source TEXT DEFAULT 'command_center',
      state TEXT,
      office TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      assigned_to TEXT,
      due_label TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'command_center'`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS state TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS office TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium'`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_label TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_vendor_action_id ON tasks ((metadata->>'vendor_action_id'))`);
}

router.get("/", async (req, res) => {
  try {
    await ensureTasksTable();

    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const status = asText(req.query.status);
    const source = asText(req.query.source);

    const params = [];
    const where = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (source) {
      params.push(source);
      where.push(`source = $${params.length}`);
    }

    params.push(limit);

    const result = await query(
      `
      SELECT *
      FROM tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        CASE status
          WHEN 'open' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'complete' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    console.error("Tasks list error:", error);
    res.status(500).json({ error: error.message || "Failed to load tasks" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureTasksTable();

    const {
      title = "",
      description = "",
      source = "command_center",
      state = "",
      office = "",
      priority = "medium",
      status = "open",
      assigned_to = "",
      due_label = "",
      metadata = {}
    } = req.body || {};

    const safeTitle = asText(title);
    const safeSource = asText(source) || "command_center";
    const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};
    const vendorActionId = getVendorActionId(safeMetadata);

    if (!safeTitle) {
      return res.status(400).json({ error: "Task title is required." });
    }

    if (isVendorTaskSource(safeSource) && vendorActionId) {
      const existing = await query(
        `
        SELECT *
        FROM tasks
        WHERE
          source IN ('vendor_network', 'vendor_intelligence')
          AND COALESCE(status, 'open') <> 'complete'
          AND metadata->>'vendor_action_id' = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [vendorActionId]
      );

      if (existing.rows.length) {
        return res.status(200).json({
          ok: true,
          duplicate: true,
          message: "Existing open vendor task returned.",
          task: existing.rows[0]
        });
      }
    }

    const result = await query(
      `
      INSERT INTO tasks (
        title,
        description,
        source,
        state,
        office,
        priority,
        status,
        assigned_to,
        due_label,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
      RETURNING *
      `,
      [
        safeTitle,
        description,
        safeSource,
        state,
        office,
        priority,
        status,
        assigned_to,
        due_label,
        JSON.stringify(safeMetadata)
      ]
    );

    res.status(201).json({
      ok: true,
      duplicate: false,
      task: result.rows[0]
    });
  } catch (error) {
    console.error("Task create error:", error);
    res.status(500).json({ error: error.message || "Failed to create task" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await ensureTasksTable();

    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ error: "Invalid task id." });

    const {
      title,
      description,
      priority,
      status,
      assigned_to,
      due_label,
      metadata
    } = req.body || {};

    const result = await query(
      `
      UPDATE tasks
      SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        assigned_to = COALESCE($6, assigned_to),
        due_label = COALESCE($7, due_label),
        metadata = COALESCE($8::jsonb, metadata),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        taskId,
        title ?? null,
        description ?? null,
        priority ?? null,
        status ?? null,
        assigned_to ?? null,
        due_label ?? null,
        metadata === undefined ? null : JSON.stringify(metadata || {})
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Task not found." });
    }

    res.json({
      ok: true,
      task: result.rows[0]
    });
  } catch (error) {
    console.error("Task update error:", error);
    res.status(500).json({ error: error.message || "Failed to update task" });
  }
});

export default router;
