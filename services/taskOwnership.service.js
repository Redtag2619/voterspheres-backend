import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

async function getTaskColumns() {
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'tasks'
  `);

  return new Set(rows.map((row) => row.column_name));
}

export async function ensureTaskOwnershipTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_assignment_audit (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      previous_owner TEXT NULL,
      next_owner TEXT NULL,
      previous_status TEXT NULL,
      next_status TEXT NULL,
      previous_due_date TIMESTAMPTZ NULL,
      next_due_date TIMESTAMPTZ NULL,
      note TEXT NULL,
      changed_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function listTaskOwners({ user = {} }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const firmUsers = await pool.query(
    `
      SELECT id, email, first_name, last_name, role, status
      FROM firm_users
      WHERE firm_id = $1
      ORDER BY first_name ASC NULLS LAST, email ASC
    `,
    [firmId]
  ).catch(() => ({ rows: [] }));

  const taskOwners = await pool.query(
    `
      SELECT DISTINCT assigned_to AS owner
      FROM tasks
      WHERE firm_id = $1
        AND assigned_to IS NOT NULL
        AND assigned_to <> ''
      ORDER BY assigned_to ASC
    `,
    [firmId]
  ).catch(() => ({ rows: [] }));

  const owners = [
    ...firmUsers.rows.map((u) => ({
      id: u.id,
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
      email: u.email,
      role: u.role || "team",
      status: u.status || "active",
      source: "firm_users",
    })),
    ...taskOwners.rows.map((o) => ({
      id: `task-owner-${o.owner}`,
      name: o.owner,
      email: "",
      role: "task_owner",
      status: "active",
      source: "tasks",
    })),
  ];

  const seen = new Set();

  return owners.filter((owner) => {
    const key = String(owner.email || owner.name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getTaskOwnershipDashboard({ user = {} }) {
  await ensureTaskOwnershipTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const owners = await listTaskOwners({ user });

  const tasks = await pool.query(
    `
      SELECT t.*, w.name AS workspace_name
      FROM tasks t
      LEFT JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.firm_id = $1
      ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST
      LIMIT 500
    `,
    [firmId]
  );

  const rows = tasks.rows || [];

  const ownerMap = new Map();

  for (const task of rows) {
    const owner = task.assigned_to || "Unassigned";

    if (!ownerMap.has(owner)) {
      ownerMap.set(owner, {
        owner,
        total: 0,
        open: 0,
        complete: 0,
        blocked: 0,
        high: 0,
        overdue: 0,
      });
    }

    const item = ownerMap.get(owner);
    const status = String(task.status || "open").toLowerCase();
    const priority = String(task.priority || "medium").toLowerCase();

    item.total += 1;
    if (["complete", "completed", "done", "resolved"].includes(status)) item.complete += 1;
    else item.open += 1;

    if (["blocked", "paused", "hold"].includes(status)) item.blocked += 1;
    if (["critical", "high"].includes(priority)) item.high += 1;

    if (task.due_date && new Date(task.due_date) < new Date() && item.complete === 0) {
      item.overdue += 1;
    }
  }

  return {
    summary: {
      total_tasks: rows.length,
      open_tasks: rows.filter((t) => !["complete", "completed", "done", "resolved"].includes(String(t.status || "").toLowerCase())).length,
      unassigned: rows.filter((t) => !t.assigned_to).length,
      blocked: rows.filter((t) => String(t.status || "").toLowerCase() === "blocked").length,
      high_priority: rows.filter((t) => ["critical", "high"].includes(String(t.priority || "").toLowerCase())).length,
      owners: owners.length,
    },
    owners,
    workload: Array.from(ownerMap.values()).sort((a, b) => b.open - a.open),
    tasks: rows,
    updated_at: new Date().toISOString(),
  };
}

export async function updateTaskOwnership({ user = {}, taskId, payload = {} }) {
  await ensureTaskOwnershipTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) throw new Error("Missing firm context.");

  const currentRes = await pool.query(
    `SELECT * FROM tasks WHERE id = $1 AND firm_id = $2 LIMIT 1`,
    [taskId, firmId]
  );

  const current = currentRes.rows[0];
  if (!current) throw new Error("Task not found.");

  const columns = await getTaskColumns();
  const fields = [];
  const values = [];
  let i = 1;

  function add(column, value) {
    if (!columns.has(column)) return;
    fields.push(`${column} = $${i}`);
    values.push(value);
    i += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "assigned_to")) {
    add("assigned_to", payload.assigned_to || null);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "owner")) {
    add("assigned_to", payload.owner || null);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    add("status", payload.status || "open");
  }

  if (Object.prototype.hasOwnProperty.call(payload, "priority")) {
    add("priority", payload.priority || "medium");
  }

  if (Object.prototype.hasOwnProperty.call(payload, "due_date")) {
    add("due_date", payload.due_date || null);
  }

  add("updated_at", new Date());

  if (!fields.length) throw new Error("No compatible task columns to update.");

  values.push(taskId, firmId);

  const updated = await pool.query(
    `
      UPDATE tasks
      SET ${fields.join(", ")}
      WHERE id = $${i} AND firm_id = $${i + 1}
      RETURNING *
    `,
    values
  );

  await pool.query(
    `
      INSERT INTO task_assignment_audit (
        firm_id, task_id, previous_owner, next_owner,
        previous_status, next_status, previous_due_date, next_due_date,
        note, changed_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      firmId,
      taskId,
      current.assigned_to || null,
      payload.assigned_to || payload.owner || current.assigned_to || null,
      current.status || null,
      payload.status || current.status || null,
      current.due_date || null,
      payload.due_date || current.due_date || null,
      payload.note || "Task ownership updated",
      userId,
    ]
  );

  return updated.rows[0];
}
