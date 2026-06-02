import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { emitRealtimeEvent } from "../services/realtime.service.js";
import { importPoliticalSignalsFromFec } from "../services/politicalSignalIngestion.service.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

function text(value = "") {
  return String(value ?? "").trim();
}

function scoreSignal(signal = {}) {
  const severity = text(signal.severity).toLowerCase();
  const type = text(signal.signal_type).toLowerCase();

  let score = 20;

  if (severity === "critical") score += 55;
  else if (severity === "high") score += 40;
  else if (severity === "medium") score += 25;
  else score += 10;

  if (["polling", "fundraising", "news", "turnout", "mailops", "vendor"].includes(type)) score += 10;
  if (signal.state) score += 5;
  if (signal.county) score += 5;

  return Math.min(100, Math.max(0, Math.round(score)));
}

function riskFromScore(score = 0) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS political_signals (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER,
      workspace_id INTEGER,
      signal_type TEXT NOT NULL DEFAULT 'general',
      source TEXT DEFAULT 'Manual',
      title TEXT NOT NULL,
      summary TEXT,
      state TEXT,
      county TEXT,
      severity TEXT DEFAULT 'medium',
      signal_score INTEGER DEFAULT 0,
      risk TEXT DEFAULT 'Stable',
      url TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      observed_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS signal_type TEXT DEFAULT 'general'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Manual'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS summary TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS county TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS signal_score INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS risk TEXT DEFAULT 'Stable'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS url TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS observed_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_firm_id ON political_signals(firm_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_workspace_id ON political_signals(workspace_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_state ON political_signals(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_type ON political_signals(signal_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_observed ON political_signals(observed_at DESC)`);
}

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    await ensureTables();

    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const result = await pool.query(
      `
        SELECT *
        FROM political_signals
        WHERE firm_id = $1
        ORDER BY observed_at DESC, created_at DESC
        LIMIT 250
      `,
      [firmId]
    );

    const rows = result.rows || [];
    const avg = rows.length
      ? Math.round(rows.reduce((sum, item) => sum + Number(item.signal_score || 0), 0) / rows.length)
      : 0;

    const byType = rows.reduce((acc, item) => {
      const key = item.signal_type || "general";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const byState = rows.reduce((acc, item) => {
      const key = item.state || "National";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      ok: true,
      summary: {
        total_signals: rows.length,
        critical: rows.filter((x) => x.risk === "Critical").length,
        high: rows.filter((x) => x.risk === "High").length,
        elevated: rows.filter((x) => x.risk === "Elevated").length,
        average_signal_score: avg,
        national_risk: riskFromScore(avg),
        by_type: byType,
        by_state: byState,
      },
      signals: rows,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load live political signals.", detail: error.message });
  }
});

router.get("/workspace/:id", requireAuth, async (req, res) => {
  try {
    await ensureTables();

    const firmId = getFirmId(req);
    const workspaceId = Number(req.params.id);

    const result = await pool.query(
      `
        SELECT *
        FROM political_signals
        WHERE firm_id = $1
          AND workspace_id = $2
        ORDER BY observed_at DESC, created_at DESC
        LIMIT 150
      `,
      [firmId, workspaceId]
    );

    return res.json({ ok: true, signals: result.rows || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load workspace signals.", detail: error.message });
  }
});

router.get("/state/:state", requireAuth, async (req, res) => {
  try {
    await ensureTables();

    const firmId = getFirmId(req);
    const state = text(req.params.state).toUpperCase();

    const result = await pool.query(
      `
        SELECT *
        FROM political_signals
        WHERE firm_id = $1
          AND UPPER(COALESCE(state, '')) = $2
        ORDER BY observed_at DESC, created_at DESC
        LIMIT 150
      `,
      [firmId, state]
    );

    return res.json({ ok: true, state, signals: result.rows || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load state signals.", detail: error.message });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    await ensureTables();

    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const title = text(req.body.title);
    if (!title) return res.status(400).json({ error: "Signal title is required" });

    const payload = {
      firm_id: firmId,
      workspace_id: req.body.workspace_id || null,
      signal_type: text(req.body.signal_type) || "general",
      source: text(req.body.source) || "Manual",
      title,
      summary: text(req.body.summary),
      state: text(req.body.state).toUpperCase() || null,
      county: text(req.body.county) || null,
      severity: text(req.body.severity) || "medium",
      url: text(req.body.url) || null,
      metadata: req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
    };

    const signalScore = scoreSignal(payload);
    const risk = riskFromScore(signalScore);

    const created = await pool.query(
      `
        INSERT INTO political_signals (
          firm_id, workspace_id, signal_type, source, title, summary,
          state, county, severity, signal_score, risk, url, metadata,
          observed_at, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NOW(),NOW(),NOW())
        RETURNING *
      `,
      [
        payload.firm_id,
        payload.workspace_id,
        payload.signal_type,
        payload.source,
        payload.title,
        payload.summary,
        payload.state,
        payload.county,
        payload.severity,
        signalScore,
        risk,
        payload.url,
        JSON.stringify(payload.metadata),
      ]
    );

    const signal = created.rows[0];

    emitRealtimeEvent({
      type: "political.signal.created",
      channel: "political-signals",
      workspace_id: signal.workspace_id,
      firm_id: signal.firm_id,
      state: signal.state,
      payload: { signal },
    });

    return res.status(201).json({ ok: true, signal });
  } catch (error) {
    res.status(500).json({ error: "Failed to create political signal.", detail: error.message });
  }
});

router.post("/ingest/fec", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const result = await importPoliticalSignalsFromFec({
      firmId,
      limit: Number(req.body?.limit || 500),
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to import FEC political signals.",
      detail: error.message,
    });
  }
});

export default router;
