import express from "express";
import {
  calculateNextRunAt,
  ensureScheduledReportTables,
  runDueScheduledReports,
  sendScheduledReport
} from "../services/scheduledReports.service.js";

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

  throw new Error("Database connection not found for scheduled reports route");
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

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);

  return String(value || "")
    .split(",")
    .map(text)
    .filter(Boolean);
}

async function requireWorkspaceAccess(req, res) {
  const firmId = getFirmId(req);
  const workspaceId = Number(req.params.workspaceId || req.body.workspace_id);

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

  const workspace = result.rows?.[0];

  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return null;
  }

  return { firmId, workspaceId, workspace };
}

router.get("/workspace/:workspaceId", async (req, res) => {
  try {
    await ensureScheduledReportTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const result = await query(
      `
        SELECT *
        FROM workspace_report_schedules
        WHERE firm_id = $1 AND workspace_id = $2
        ORDER BY enabled DESC, next_run_at ASC NULLS LAST, created_at DESC
      `,
      [access.firmId, access.workspaceId]
    );

    return res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load scheduled reports"
    });
  }
});

router.post("/workspace/:workspaceId", async (req, res) => {
  try {
    await ensureScheduledReportTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const recipients = normalizeRecipients(req.body.recipients || req.body.to);
    if (!recipients.length) {
      return res.status(400).json({ error: "At least one recipient is required" });
    }

    const schedule = {
      frequency: text(req.body.frequency) || "weekly",
      day_of_week: Number(req.body.day_of_week ?? 1),
      hour: Number(req.body.hour ?? 9)
    };

    const nextRunAt = calculateNextRunAt(schedule, new Date());

    const result = await query(
      `
        INSERT INTO workspace_report_schedules (
          firm_id,
          workspace_id,
          name,
          recipients,
          frequency,
          day_of_week,
          hour,
          timezone,
          enabled,
          next_run_at,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        RETURNING *
      `,
      [
        access.firmId,
        access.workspaceId,
        text(req.body.name) || `${access.workspace.name || "Workspace"} Scheduled Report`,
        recipients,
        schedule.frequency,
        schedule.day_of_week,
        schedule.hour,
        text(req.body.timezone) || "America/Chicago",
        req.body.enabled === undefined ? true : Boolean(req.body.enabled),
        nextRunAt,
        getUserId(req)
      ]
    );

    return res.status(201).json({
      ok: true,
      schedule: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create scheduled report"
    });
  }
});

router.patch("/:scheduleId", async (req, res) => {
  try {
    await ensureScheduledReportTables();

    const firmId = getFirmId(req);
    const scheduleId = Number(req.params.scheduleId);

    if (!firmId) return res.status(401).json({ error: "Missing firm context" });
    if (!Number.isFinite(scheduleId)) return res.status(400).json({ error: "Invalid schedule id" });

    const current = await query(
      `
        SELECT *
        FROM workspace_report_schedules
        WHERE id = $1 AND firm_id = $2
        LIMIT 1
      `,
      [scheduleId, firmId]
    );

    const existing = current.rows?.[0];
    if (!existing) return res.status(404).json({ error: "Schedule not found" });

    const frequency = req.body.frequency === undefined ? existing.frequency : text(req.body.frequency) || "weekly";
    const dayOfWeek = req.body.day_of_week === undefined ? existing.day_of_week : Number(req.body.day_of_week);
    const hour = req.body.hour === undefined ? existing.hour : Number(req.body.hour);

    const nextRunAt = calculateNextRunAt(
      {
        frequency,
        day_of_week: dayOfWeek,
        hour
      },
      new Date()
    );

    const recipients =
      req.body.recipients === undefined
        ? existing.recipients
        : normalizeRecipients(req.body.recipients);

    const result = await query(
      `
        UPDATE workspace_report_schedules
        SET
          name = $3,
          recipients = $4::text[],
          frequency = $5,
          day_of_week = $6,
          hour = $7,
          timezone = $8,
          enabled = $9,
          next_run_at = $10,
          updated_at = NOW()
        WHERE id = $1 AND firm_id = $2
        RETURNING *
      `,
      [
        scheduleId,
        firmId,
        req.body.name === undefined ? existing.name : text(req.body.name) || existing.name,
        recipients,
        frequency,
        dayOfWeek,
        hour,
        req.body.timezone === undefined ? existing.timezone : text(req.body.timezone) || "America/Chicago",
        req.body.enabled === undefined ? existing.enabled : Boolean(req.body.enabled),
        nextRunAt
      ]
    );

    return res.json({
      ok: true,
      schedule: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update scheduled report"
    });
  }
});

router.post("/:scheduleId/run-now", async (req, res) => {
  try {
    await ensureScheduledReportTables();

    const firmId = getFirmId(req);
    const scheduleId = Number(req.params.scheduleId);

    if (!firmId) return res.status(401).json({ error: "Missing firm context" });
    if (!Number.isFinite(scheduleId)) return res.status(400).json({ error: "Invalid schedule id" });

    const result = await query(
      `
        SELECT *
        FROM workspace_report_schedules
        WHERE id = $1 AND firm_id = $2
        LIMIT 1
      `,
      [scheduleId, firmId]
    );

    const schedule = result.rows?.[0];
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });

    const sendResult = await sendScheduledReport(schedule);

    return res.json({
      ok: true,
      ...sendResult
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to run scheduled report"
    });
  }
});

router.post("/run-due", async (req, res) => {
  try {
    const result = await runDueScheduledReports({
      limit: Number(req.body.limit || 10)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to run due scheduled reports"
    });
  }
});

router.delete("/:scheduleId", async (req, res) => {
  try {
    await ensureScheduledReportTables();

    const firmId = getFirmId(req);
    const scheduleId = Number(req.params.scheduleId);

    if (!firmId) return res.status(401).json({ error: "Missing firm context" });
    if (!Number.isFinite(scheduleId)) return res.status(400).json({ error: "Invalid schedule id" });

    const result = await query(
      `
        DELETE FROM workspace_report_schedules
        WHERE id = $1 AND firm_id = $2
        RETURNING id
      `,
      [scheduleId, firmId]
    );

    if (!result.rows?.[0]) return res.status(404).json({ error: "Schedule not found" });

    return res.json({
      ok: true,
      deleted: result.rows[0].id
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to delete scheduled report"
    });
  }
});

export default router;
