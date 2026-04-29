import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizeStatus(value = "open") {
  const status = text(value).toLowerCase();
  if (["complete", "completed", "done"].includes(status)) return "complete";
  if (["in_progress", "in progress", "started", "active"].includes(status)) return "in_progress";
  if (["blocked", "hold", "paused"].includes(status)) return "blocked";
  return "open";
}

function normalizePriority(value = "medium") {
  const priority = text(value).toLowerCase();
  if (["critical", "high"].includes(priority)) return priority;
  if (priority === "low") return "low";
  return "medium";
}

function normalizeMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function getDedupeKey(metadata = {}) {
  return (
    text(metadata.vendor_action_id) ||
    text(metadata.feed_id) ||
    text(metadata.signal_id) ||
    text(metadata.action_id) ||
    ""
  );
}

async function ensureTasksTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      source TEXT DEFAULT 'command_center',
      state TEXT DEFAULT 'National',
      office TEXT DEFAULT 'Statewide',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      assigned_to TEXT DEFAULT 'Command Team',
      due_label TEXT DEFAULT 'Today',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const columns = [
    ["title", "TEXT"],
    ["description", "TEXT"],
    ["source", "TEXT DEFAULT 'command_center'"],
    ["state", "TEXT DEFAULT 'National'"],
    ["office", "TEXT DEFAULT 'Statewide'"],
    ["priority", "TEXT DEFAULT 'medium'"],
    ["status", "TEXT DEFAULT 'open'"],
    ["assigned_to", "TEXT DEFAULT 'Command Team'"],
    ["due_label", "TEXT DEFAULT 'Today'"],
    ["metadata", "JSONB DEFAULT '{}'::jsonb"],
    ["created_at", "TIMESTAMP DEFAULT NOW()"],
    ["updated_at", "TIMESTAMP DEFAULT NOW()"]
  ];

  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_metadata_feed_id ON tasks((metadata->>'feed_id'))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_metadata_signal_id ON tasks((metadata->>'signal_id'))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_metadata_vendor_action_id ON tasks((metadata->>'vendor_action_id'))`);
}

async function findDuplicateTask(metadata = {}) {
  const vendorActionId = text(metadata.vendor_action_id);
  const feedId = text(metadata.feed_id);
  const signalId = text(metadata.signal_id);
  const actionId = text(metadata.action_id);

  if (!vendorActionId && !feedId && !signalId && !actionId) return null;

  const result = await pool.query(
    `
    SELECT *
    FROM tasks
    WHERE
      ($1 <> '' AND metadata->>'vendor_action_id' = $1)
      OR ($2 <> '' AND metadata->>'feed_id' = $2)
      OR ($3 <> '' AND metadata->>'signal_id' = $3)
      OR ($4 <> '' AND metadata->>'action_id' = $4)
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [vendorActionId, feedId, signalId, actionId]
  );

  return result.rows[0] || null;
}

router.get("/", async (req, res) => {
  try {
    await ensureTasksTable();

    const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 100));
    const status = text(req.query.status).toLowerCase();
    const source = text(req.query.source).toLowerCase();

    const result = await pool.query(
      `
      SELECT *
      FROM tasks
      WHERE ($1 = '' OR LOWER(COALESCE(status, '')) = $1)
        AND ($2 = '' OR LOWER(COALESCE(source, '')) = $2)
      ORDER BY
        CASE LOWER(COALESCE(status, 'open'))
          WHEN 'open' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'complete' THEN 3
          ELSE 4
        END,
        updated_at DESC,
        created_at DESC
      LIMIT $3
      `,
      [status, source, limit]
    );

    res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load tasks" });
  }
});

router.get("/feed-state", async (req, res) => {
  try {
    await ensureTasksTable();

    const ids = String(req.query.ids || "")
      .split(",")
      .map((item) => text(item))
      .filter(Boolean)
      .slice(0, 100);

    if (!ids.length) {
      return res.json({ ok: true, results: {} });
    }

    const result = await pool.query(
      `
      SELECT id, title, status, source, metadata, updated_at
      FROM tasks
      WHERE metadata->>'feed_id' = ANY($1::text[])
         OR metadata->>'signal_id' = ANY($1::text[])
      ORDER BY updated_at DESC
      `,
      [ids]
    );

    const results = {};

    for (const task of result.rows) {
      const feedId = task.metadata?.feed_id || task.metadata?.signal_id;
      if (!feedId || results[feedId]) continue;

      results[feedId] = {
        exists: true,
        task_id: task.id,
        status: task.status || "open",
        source: task.source,
        title: task.title,
        updated_at: task.updated_at
      };
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load feed task state" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureTasksTable();

    const metadata = normalizeMetadata(req.body.metadata);
    const duplicate = await findDuplicateTask(metadata);

    if (duplicate) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        task: duplicate,
        dedupe_key: getDedupeKey(metadata)
      });
    }

    const payload = {
      title: text(req.body.title) || "Untitled task",
      description: text(req.body.description),
      source: text(req.body.source) || "command_center",
      state: text(req.body.state) || "National",
      office: text(req.body.office) || "Statewide",
      priority: normalizePriority(req.body.priority),
      status: normalizeStatus(req.body.status),
      assigned_to: text(req.body.assigned_to) || "Command Team",
      due_label: text(req.body.due_label) || "Today",
      metadata
    };

    const result = await pool.query(
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
        payload.title,
        payload.description,
        payload.source,
        payload.state,
        payload.office,
        payload.priority,
        payload.status,
        payload.assigned_to,
        payload.due_label,
        JSON.stringify(payload.metadata)
      ]
    );

    res.status(201).json({
      ok: true,
      duplicate: false,
      task: result.rows[0],
      dedupe_key: getDedupeKey(metadata)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to create task" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await ensureTasksTable();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (!existing.rows[0]) {
      return res.status(404).json({ error: "Task not found" });
    }

    const current = existing.rows[0];
    const metadata = req.body.metadata
      ? { ...(current.metadata || {}), ...normalizeMetadata(req.body.metadata) }
      : current.metadata || {};

    const result = await pool.query(
      `
      UPDATE tasks
      SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        source = COALESCE($4, source),
        state = COALESCE($5, state),
        office = COALESCE($6, office),
        priority = COALESCE($7, priority),
        status = COALESCE($8, status),
        assigned_to = COALESCE($9, assigned_to),
        due_label = COALESCE($10, due_label),
        metadata = $11::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        req.body.title === undefined ? null : text(req.body.title),
        req.body.description === undefined ? null : text(req.body.description),
        req.body.source === undefined ? null : text(req.body.source),
        req.body.state === undefined ? null : text(req.body.state),
        req.body.office === undefined ? null : text(req.body.office),
        req.body.priority === undefined ? null : normalizePriority(req.body.priority),
        req.body.status === undefined ? null : normalizeStatus(req.body.status),
        req.body.assigned_to === undefined ? null : text(req.body.assigned_to),
        req.body.due_label === undefined ? null : text(req.body.due_label),
        JSON.stringify(metadata)
      ]
    );

    res.json({ ok: true, task: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to update task" });
  }
});

router.put("/:id", async (req, res) => {
  req.method = "PATCH";
  router.handle(req, res);
});

export default router;
