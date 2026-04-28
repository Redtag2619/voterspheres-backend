import express from "express";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

const router = express.Router();

function text(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  const v = text(value);
  return v.length === 2 ? v.toUpperCase() : v;
}

function scoreCoverage(vendorCount, categoryCount, activeCount) {
  const vendorScore = Math.min(45, vendorCount * 12);
  const categoryScore = Math.min(35, categoryCount * 10);
  const activeScore = Math.min(20, activeCount * 8);
  return Math.min(100, vendorScore + categoryScore + activeScore);
}

function tierForScore(score) {
  if (score >= 80) return "Strong";
  if (score >= 55) return "Adequate";
  if (score >= 30) return "Thin";
  return "Gap";
}

function riskForScore(score) {
  if (score < 30) return "High";
  if (score < 55) return "Medium";
  return "Low";
}

async function ensureVendorsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      vendor_name TEXT,
      name TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      state TEXT,
      city TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      services TEXT,
      capabilities TEXT,
      coverage_area TEXT,
      campaign_name TEXT,
      candidate_name TEXT,
      firm_name TEXT,
      office TEXT,
      contract_value NUMERIC DEFAULT 0,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const columns = [
    ["vendor_name", "TEXT"],
    ["name", "TEXT"],
    ["category", "TEXT"],
    ["status", "TEXT DEFAULT 'active'"],
    ["state", "TEXT"],
    ["city", "TEXT"],
    ["website", "TEXT"],
    ["email", "TEXT"],
    ["phone", "TEXT"],
    ["services", "TEXT"],
    ["capabilities", "TEXT"],
    ["coverage_area", "TEXT"],
    ["campaign_name", "TEXT"],
    ["candidate_name", "TEXT"],
    ["firm_name", "TEXT"],
    ["office", "TEXT"],
    ["contract_value", "NUMERIC DEFAULT 0"],
    ["notes", "TEXT"],
    ["source", "TEXT DEFAULT 'manual'"],
    ["source_updated_at", "TIMESTAMP"],
    ["created_at", "TIMESTAMP DEFAULT NOW()"],
    ["updated_at", "TIMESTAMP DEFAULT NOW()"]
  ];

  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_state ON vendors(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status)`);
}

async function seedVendorsIfEmpty() {
  await ensureVendorsTable();

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM vendors`);
  if (Number(rows[0]?.total || 0) > 0) return;

  await pool.query(`
    INSERT INTO vendors (
      vendor_name,
      name,
      category,
      status,
      state,
      city,
      website,
      email,
      phone,
      services,
      capabilities,
      coverage_area,
      contract_value,
      source,
      source_updated_at
    )
    VALUES
      (
        'Patriot Direct Mail',
        'Patriot Direct Mail',
        'Mail',
        'active',
        'GA',
        'Atlanta',
        'https://example.com',
        'hello@example.com',
        '',
        'USPS political mail, high-volume drops, postal logistics',
        'Direct mail, USPS escalation, campaign mail tracking',
        'Southeast',
        85000,
        'manual_live_seed',
        NOW()
      ),
      (
        'Victory Digital',
        'Victory Digital',
        'Digital',
        'active',
        'AZ',
        'Phoenix',
        'https://example.com',
        'hello@example.com',
        '',
        'Programmatic ads, voter targeting, persuasion audiences',
        'Digital advertising, voter targeting, reporting',
        'National',
        120000,
        'manual_live_seed',
        NOW()
      ),
      (
        'Liberty Field Ops',
        'Liberty Field Ops',
        'Field',
        'active',
        'PA',
        'Harrisburg',
        'https://example.com',
        'hello@example.com',
        '',
        'Door-to-door canvassing, GOTV, voter contact',
        'Field operations, canvassing, GOTV',
        'Mid-Atlantic',
        64000,
        'manual_live_seed',
        NOW()
      ),
      (
        'Capitol Media Group',
        'Capitol Media Group',
        'Media Buying',
        'watch',
        'DC',
        'Washington',
        'https://example.com',
        'hello@example.com',
        '',
        'TV, radio, streaming ad placement',
        'Media buying, broadcast, streaming',
        'National',
        175000,
        'manual_live_seed',
        NOW()
      )
  `);
}

/* --------------------------
   VENDOR INTELLIGENCE SCORING
-------------------------- */
router.get("/intelligence/scoring", async (_req, res) => {
  try {
    await seedVendorsIfEmpty();

    const stateRows = await pool.query(`
      SELECT
        COALESCE(NULLIF(state, ''), 'Unknown') AS state,
        COUNT(*)::int AS vendor_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) <> 'active')::int AS watch_count,
        COUNT(DISTINCT NULLIF(category, ''))::int AS category_count,
        COALESCE(SUM(COALESCE(contract_value, 0)), 0)::numeric AS total_contract_value
      FROM vendors
      GROUP BY COALESCE(NULLIF(state, ''), 'Unknown')
      ORDER BY vendor_count DESC, state ASC
    `);

    const categoryRows = await pool.query(`
      SELECT
        COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
        COUNT(*)::int AS vendor_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_count,
        COUNT(DISTINCT NULLIF(state, ''))::int AS states_covered,
        COALESCE(SUM(COALESCE(contract_value, 0)), 0)::numeric AS total_contract_value
      FROM vendors
      GROUP BY COALESCE(NULLIF(category, ''), 'Uncategorized')
      ORDER BY vendor_count DESC, category ASC
    `);

    const vendorRows = await pool.query(`
      SELECT
        id,
        COALESCE(vendor_name, name, 'Unnamed Vendor') AS vendor_name,
        COALESCE(category, 'General') AS category,
        COALESCE(status, 'active') AS status,
        state,
        city,
        website,
        email,
        phone,
        COALESCE(services, capabilities, '') AS services,
        campaign_name,
        candidate_name,
        firm_name,
        office,
        COALESCE(contract_value, 0)::numeric AS contract_value,
        updated_at,
        created_at
      FROM vendors
      ORDER BY
        CASE WHEN LOWER(COALESCE(status, '')) = 'active' THEN 0 ELSE 1 END,
        COALESCE(contract_value, 0) DESC,
        COALESCE(vendor_name, name, 'zzz') ASC
      LIMIT 100
    `);

    const coverage = stateRows.rows.map((row) => {
      const vendorCount = Number(row.vendor_count || 0);
      const categoryCount = Number(row.category_count || 0);
      const activeCount = Number(row.active_count || 0);
      const score = scoreCoverage(vendorCount, categoryCount, activeCount);

      return {
        state: row.state,
        vendor_count: vendorCount,
        active_count: activeCount,
        watch_count: Number(row.watch_count || 0),
        category_count: categoryCount,
        total_contract_value: Number(row.total_contract_value || 0),
        coverage_score: score,
        coverage_tier: tierForScore(score),
        risk: riskForScore(score)
      };
    });

    const gaps = coverage
      .filter((row) => row.coverage_score < 55)
      .map((row) => ({
        state: row.state,
        severity: row.coverage_score < 30 ? "High" : "Medium",
        title: `${row.state} vendor coverage ${row.coverage_tier}`,
        detail:
          row.coverage_score < 30
            ? "Critical vendor coverage gap. Add direct mail, digital, field, and compliance capacity."
            : "Thin vendor bench. Add backup capacity before campaign volume increases.",
        coverage_score: row.coverage_score,
        vendor_count: row.vendor_count,
        category_count: row.category_count
      }));

    const riskSignals = vendorRows.rows
      .filter((row) => String(row.status || "").toLowerCase() !== "active")
      .map((row) => ({
        id: row.id,
        vendor_name: row.vendor_name,
        state: row.state,
        category: row.category,
        status: row.status,
        severity: "Medium",
        title: `${row.vendor_name} requires review`,
        detail: `Status is ${row.status}. Confirm operational readiness and backup vendor coverage.`
      }));

    const recommendedActions = [
      ...gaps.slice(0, 6).map((gap, index) => ({
        id: `vendor-gap-${index}`,
        priority: gap.severity,
        title: `Close ${gap.state} vendor gap`,
        owner: "Vendor Intelligence",
        due: gap.severity === "High" ? "Today" : "This Week",
        detail: gap.detail,
        state: gap.state
      })),
      ...riskSignals.slice(0, 4).map((signal) => ({
        id: `vendor-risk-${signal.id}`,
        priority: signal.severity,
        title: `Review ${signal.vendor_name}`,
        owner: "Operations",
        due: "This Week",
        detail: signal.detail,
        state: signal.state
      }))
    ].slice(0, 10);

    const totalVendors = vendorRows.rows.length;
    const activeVendors = vendorRows.rows.filter(
      (row) => String(row.status || "").toLowerCase() === "active"
    ).length;

    res.json({
      generated_at: new Date().toISOString(),
      summary: {
        total_vendors: totalVendors,
        active_vendors: activeVendors,
        states_covered: coverage.filter((row) => row.state !== "Unknown").length,
        categories_covered: categoryRows.rows.length,
        high_gap_states: gaps.filter((row) => row.severity === "High").length,
        medium_gap_states: gaps.filter((row) => row.severity === "Medium").length
      },
      coverage,
      categories: categoryRows.rows.map((row) => ({
        category: row.category,
        vendor_count: Number(row.vendor_count || 0),
        active_count: Number(row.active_count || 0),
        states_covered: Number(row.states_covered || 0),
        total_contract_value: Number(row.total_contract_value || 0)
      })),
      gaps,
      risk_signals: riskSignals,
      recommended_actions: recommendedActions,
      vendors: vendorRows.rows,
      _live: true
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Failed to load vendor intelligence scoring"
    });
  }
});

/* --------------------------
   STATES
-------------------------- */
router.get("/states", async (_req, res) => {
  try {
    await seedVendorsIfEmpty();

    const { rows } = await pool.query(`
      SELECT DISTINCT state
      FROM vendors
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    res.json({
      results: rows.map((r) => r.state),
      states: rows.map((r) => r.state)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load states" });
  }
});

/* --------------------------
   DROPDOWNS
-------------------------- */
router.get("/dropdowns/categories", async (_req, res) => {
  try {
    await seedVendorsIfEmpty();

    const { rows } = await pool.query(`
      SELECT DISTINCT category
      FROM vendors
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category ASC
    `);

    res.json({
      results: rows.map((r) => r.category)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed categories" });
  }
});

router.get("/dropdowns/statuses", async (_req, res) => {
  try {
    await seedVendorsIfEmpty();

    const { rows } = await pool.query(`
      SELECT DISTINCT status
      FROM vendors
      WHERE status IS NOT NULL AND status <> ''
      ORDER BY status ASC
    `);

    res.json({
      results: rows.map((r) => r.status)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed statuses" });
  }
});

/* --------------------------
   MAIN LIST
-------------------------- */
router.get("/", async (req, res) => {
  try {
    await seedVendorsIfEmpty();

    const {
      q = "",
      search = "",
      state = "",
      category = "",
      status = "",
      page = 1,
      limit = 12
    } = req.query;

    const term = text(search || q);
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
    const offset = (safePage - 1) * safeLimit;

    const values = [
      term,
      normalizeState(state),
      text(category),
      text(status),
      safeLimit,
      offset
    ];

    const whereSql = `
      WHERE
        ($1 = '' OR (
          COALESCE(vendor_name, name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(category, '') ILIKE '%' || $1 || '%'
          OR COALESCE(state, '') ILIKE '%' || $1 || '%'
          OR COALESCE(city, '') ILIKE '%' || $1 || '%'
          OR COALESCE(services, capabilities, '') ILIKE '%' || $1 || '%'
        ))
        AND ($2 = '' OR UPPER(COALESCE(state, '')) = $2)
        AND ($3 = '' OR COALESCE(category, '') = $3)
        AND ($4 = '' OR COALESCE(status, '') = $4)
    `;

    const data = await pool.query(
      `
      SELECT
        id,
        COALESCE(vendor_name, name, 'Unnamed Vendor') AS vendor_name,
        COALESCE(vendor_name, name, 'Unnamed Vendor') AS name,
        COALESCE(category, 'General') AS category,
        COALESCE(status, 'active') AS status,
        state,
        city,
        website,
        email,
        phone,
        COALESCE(services, capabilities, '') AS services,
        capabilities,
        coverage_area,
        campaign_name,
        candidate_name,
        firm_name,
        office,
        COALESCE(contract_value, 0)::numeric AS contract_value,
        notes,
        source,
        source_updated_at,
        created_at,
        updated_at,
        CASE
          WHEN LOWER(COALESCE(status, '')) = 'active' THEN 'Monitor'
          WHEN LOWER(COALESCE(status, '')) LIKE '%risk%' THEN 'Elevated'
          WHEN LOWER(COALESCE(status, '')) = 'watch' THEN 'Watch'
          ELSE 'Watch'
        END AS risk
      FROM vendors
      ${whereSql}
      ORDER BY COALESCE(vendor_name, name, 'zzz') ASC
      LIMIT $5 OFFSET $6
      `,
      values
    );

    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM vendors ${whereSql}`,
      values.slice(0, 4)
    );

    const summary = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_vendors,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_vendors,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) <> 'active')::int AS watch_vendors,
        COUNT(DISTINCT NULLIF(state, ''))::int AS states_covered,
        COUNT(DISTINCT NULLIF(category, ''))::int AS categories_covered,
        COALESCE(SUM(COALESCE(contract_value, 0)), 0)::numeric AS total_contract_value
      FROM vendors
      ${whereSql}
      `,
      values.slice(0, 4)
    );

    res.json({
      total: total.rows[0]?.count || 0,
      page: safePage,
      limit: safeLimit,
      summary: summary.rows[0] || {},
      results: data.rows,
      _live: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed vendors" });
  }
});

/* --------------------------
   IMPORT ADMIN PLACEHOLDER
-------------------------- */
router.post("/import", requireRoles("admin"), async (_req, res) => {
  try {
    await seedVendorsIfEmpty();

    res.json({
      ok: true,
      message: "Import endpoint ready. Vendor scoring is live at /api/vendors/intelligence/scoring."
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Import failed" });
  }
});

/* --------------------------
   DISPATCH VENDOR ALERTS
-------------------------- */
router.post("/intelligence/dispatch-alerts", async (_req, res) => {
  try {
    await seedVendorsIfEmpty();

    const { publishRealtimeEvent } = await import("../lib/realtime.bus.js");

    const result = await pool.query(`
      SELECT
        COALESCE(NULLIF(state, ''), 'Unknown') AS state,
        COUNT(*)::int AS vendor_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_count,
        COUNT(DISTINCT NULLIF(category, ''))::int AS category_count
      FROM vendors
      GROUP BY COALESCE(NULLIF(state, ''), 'Unknown')
      ORDER BY vendor_count DESC, state ASC
    `);

    const alerts = result.rows
      .map((row) => {
        const vendorCount = Number(row.vendor_count || 0);
        const activeCount = Number(row.active_count || 0);
        const categoryCount = Number(row.category_count || 0);
        const score = scoreCoverage(vendorCount, categoryCount, activeCount);

        if (score >= 55) return null;

        return {
          event_type: "vendor.coverage_gap",
          title: `${row.state} vendor coverage gap`,
          severity: score < 30 ? "High" : "Medium",
          source: "Vendor Intelligence",
          state: row.state,
          office: "Statewide",
          risk: score < 30 ? "Elevated" : "Watch",
          detail:
            score < 30
              ? "Critical vendor coverage gap. Add direct mail, digital, field, and compliance capacity."
              : "Thin vendor bench. Add backup capacity before campaign volume increases.",
          coverage_score: score,
          vendor_count: vendorCount,
          active_count: activeCount,
          category_count: categoryCount
        };
      })
      .filter(Boolean);

    for (const alert of alerts) {
      publishRealtimeEvent({
        type: "alert.dispatched",
        channel: "intelligence:global",
        payload: { alert }
      });
    }

    res.json({
      ok: true,
      dispatched: alerts.length,
      alerts
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Failed to dispatch vendor alerts"
    });
  }
});

export default router;
