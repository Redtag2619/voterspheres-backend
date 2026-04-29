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

function initialsFromName(name = "Command Team") {
  return text(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CT";
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
      assigned_to_user_id TEXT,
      assigned_to_email TEXT,
      assignee_avatar TEXT,
      assignee_initials TEXT,
      created_by TEXT,
      created_by_user_id TEXT,
      created_by_email TEXT,
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
    ["assigned_to_user_id", "TEXT"],
    ["assigned_to_email", "TEXT"],
    ["assignee_avatar", "TEXT"],
    ["assignee_initials", "TEXT"],
    ["created_by", "TEXT"],
    ["created_by_user_id", "TEXT"],
    ["created_by_email", "TEXT"],
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id ON tasks(assigned_to_user_id)`);
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

function normalizeTaskPayload(body = {}, current = {}) {
  const assignedTo =
    text(body.assigned_to) ||
    text(body.assignee_name) ||
    text(current.assigned_to) ||
    "Command Team";

  return {
    title: text(body.title) || text(current.title) || "Untitled task",
    description:
      body.description === undefined ? current.description || "" : text(body.description),
    source: text(body.source) || text(current.source) || "command_center",
    state: text(body.state) || text(current.state) || "National",
    office: text(body.office) || text(current.office) || "Statewide",
    priority:
      body.priority === undefined
        ? normalizePriority(current.priority || "medium")
        : normalizePriority(body.priority),
    status:
      body.status === undefined
        ? normalizeStatus(current.status || "open")
        : normalizeStatus(body.status),
    assigned_to: assignedTo,
    assigned_to_user_id:
      body.assigned_to_user_id === undefined
        ? current.assigned_to_user_id || null
        : text(body.assigned_to_user_id) || null,
    assigned_to_email:
      body.assigned_to_email === undefined
        ? current.assigned_to_email || null
        : text(body.assigned_to_email) || null,
    assignee_avatar:
      body.assignee_avatar === undefined
        ? current.assignee_avatar || null
        : text(body.assignee_avatar) || null,
    assignee_initials:
      text(body.assignee_initials) ||
      text(current.assignee_initials) ||
      initialsFromName(assignedTo),
    created_by:
      body.created_by === undefined
        ? current.created_by || "System"
        : text(body.created_by) || "System",
    created_by_user_id:
      body.created_by_user_id === undefined
        ? current.created_by_user_id || null
        : text(body.created_by_user_id) || null,
    created_by_email:
      body.created_by_email === undefined
        ? current.created_by_email || null
        : text(body.created_by_email) || null,
    due_label: text(body.due_label) || text(current.due_label) || "Today"
  };
}

router.get("/", async (req, res) => {
  try {
    await ensureTasksTable();

    const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 100));
    const status = text(req.query.status).toLowerCase();
    const source = text(req.query.source).toLowerCase();
    const assignedTo = text(req.query.assigned_to).toLowerCase();
    const assignedToUserId = text(req.query.assigned_to_user_id);

    const result = await pool.query(
      `
      SELECT *
      FROM tasks
      WHERE ($1 = '' OR LOWER(COALESCE(status, '')) = $1)
        AND ($2 = '' OR LOWER(COALESCE(source, '')) = $2)
        AND ($3 = '' OR LOWER(COALESCE(assigned_to, '')) = $3)
        AND ($4 = '' OR COALESCE(assigned_to_user_id, '') = $4)
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
      LIMIT $5
      `,
      [status, source, assignedTo, assignedToUserId, limit]
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

router.get("/assignees", async (_req, res) => {
  try {
    await ensureTasksTable();

    const result = await pool.query(`
      SELECT
        COALESCE(NULLIF(assigned_to, ''), 'Command Team') AS name,
        COALESCE(NULLIF(assigned_to_user_id, ''), '') AS user_id,
        COALESCE(NULLIF(assigned_to_email, ''), '') AS email,
        COALESCE(NULLIF(assignee_avatar, ''), '') AS avatar,
        COALESCE(NULLIF(assignee_initials, ''), '') AS initials,
        COUNT(*)::int AS task_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) <> 'complete')::int AS open_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'complete')::int AS complete_count
      FROM tasks
      GROUP BY
        COALESCE(NULLIF(assigned_to, ''), 'Command Team'),
        COALESCE(NULLIF(assigned_to_user_id, ''), ''),
        COALESCE(NULLIF(assigned_to_email, ''), ''),
        COALESCE(NULLIF(assignee_avatar, ''), ''),
        COALESCE(NULLIF(assignee_initials, ''), '')
      ORDER BY open_count DESC, task_count DESC, name ASC
    `);

    res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows.map((row) => ({
        ...row,
        initials: row.initials || initialsFromName(row.name)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load assignees" });
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
      SELECT
        id,
        title,
        status,
        source,
        assigned_to,
        assigned_to_user_id,
        assigned_to_email,
        assignee_avatar,
        assignee_initials,
        metadata,
        updated_at
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
        assigned_to: task.assigned_to || "Command Team",
        assigned_to_user_id: task.assigned_to_user_id,
        assigned_to_email: task.assigned_to_email,
        assignee_avatar: task.assignee_avatar,
        assignee_initials: task.assignee_initials || initialsFromName(task.assigned_to),
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

    const payload = normalizeTaskPayload(req.body);

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
        assigned_to_user_id,
        assigned_to_email,
        assignee_avatar,
        assignee_initials,
        created_by,
        created_by_user_id,
        created_by_email,
        due_label,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,NOW(),NOW())
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
        payload.assigned_to_user_id,
        payload.assigned_to_email,
        payload.assignee_avatar,
        payload.assignee_initials,
        payload.created_by,
        payload.created_by_user_id,
        payload.created_by_email,
        payload.due_label,
        JSON.stringify(metadata)
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

    const payload = normalizeTaskPayload(req.body, current);

    const result = await pool.query(
      `
      UPDATE tasks
      SET
        title = $2,
        description = $3,
        source = $4,
        state = $5,
        office = $6,
        priority = $7,
        status = $8,
        assigned_to = $9,
        assigned_to_user_id = $10,
        assigned_to_email = $11,
        assignee_avatar = $12,
        assignee_initials = $13,
        created_by = $14,
        created_by_user_id = $15,
        created_by_email = $16,
        due_label = $17,
        metadata = $18::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        payload.title,
        payload.description,
        payload.source,
        payload.state,
        payload.office,
        payload.priority,
        payload.status,
        payload.assigned_to,
        payload.assigned_to_user_id,
        payload.assigned_to_email,
        payload.assignee_avatar,
        payload.assignee_initials,
        payload.created_by,
        payload.created_by_user_id,
        payload.created_by_email,
        payload.due_label,
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
