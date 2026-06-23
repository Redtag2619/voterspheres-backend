import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

const FEC_API_BASE_URL =
  process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1";

const FEC_API_KEY =
  process.env.FEC_API_KEY || process.env.OPENFEC_API_KEY || "";

const DEFAULT_CYCLE = Number(process.env.FEC_DEFAULT_CYCLE || 2026);

function text(value = "") {
  return String(value || "").trim();
}

function money(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeState(value = "") {
  return String(value || "").trim().toUpperCase();
}

function safeLimit(value, fallback = 100, max = 250) {
  return Math.max(1, Math.min(Number(value) || fallback, max));
}

function inferVendorCategory(purpose = "", payee = "") {
  const haystack = `${purpose} ${payee}`.toLowerCase();

  if (/(mail|postage|printing|print|postcard|letter|mailer)/.test(haystack)) {
    return "Direct Mail";
  }

  if (/(media|advertising|tv|radio|broadcast|digital|facebook|google|meta|youtube|streaming|ad buy|placement)/.test(haystack)) {
    return "Media / Advertising";
  }

  if (/(consult|strategy|strategic|field|canvass|organizing|poll|survey|research)/.test(haystack)) {
    return "Consulting / Strategy";
  }

  if (/(software|data|technology|database|hosting|website|text|sms|email|crm)/.test(haystack)) {
    return "Data / Technology";
  }

  if (/(fundraising|finance|compliance|treasurer|accounting|legal|law)/.test(haystack)) {
    return "Fundraising / Compliance";
  }

  if (/(event|venue|catering|travel|lodging|hotel|airline|transport)/.test(haystack)) {
    return "Events / Travel";
  }

  return "Campaign Operations";
}

function inferStatus(lastSpendDate) {
  if (!lastSpendDate) return "watch";

  const then = new Date(lastSpendDate).getTime();
  if (!Number.isFinite(then)) return "watch";

  const days = (Date.now() - then) / 86400000;

  if (days <= 120) return "active";
  if (days <= 365) return "watch";
  return "inactive";
}

function performanceFromSpend(totalAmount = 0, transactionCount = 0, stateCount = 0) {
  const amountScore = Math.min(45, Math.round(money(totalAmount) / 25000));
  const activityScore = Math.min(35, Number(transactionCount || 0) * 3);
  const coverageScore = Math.min(20, Number(stateCount || 0) * 5);

  return Math.max(35, Math.min(100, amountScore + activityScore + coverageScore));
}

function riskFromSpend(totalAmount = 0, transactionCount = 0) {
  const value = 100 - performanceFromSpend(totalAmount, transactionCount, 1);
  return Math.max(5, Math.min(95, value));
}

async function ensureVendorFecTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_fec_spend (
      id SERIAL PRIMARY KEY,
      vendor_name TEXT,
      payee_name TEXT,
      committee_id TEXT,
      committee_name TEXT,
      state TEXT,
      payee_state TEXT,
      payee_city TEXT,
      payee_zip TEXT,
      purpose TEXT,
      category TEXT,
      amount NUMERIC DEFAULT 0,
      disbursement_date DATE,
      cycle INTEGER,
      transaction_id TEXT,
      source TEXT DEFAULT 'fec_schedule_b',
      source_updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS vendor_name TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS payee_name TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS committee_id TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS committee_name TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS payee_state TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS payee_city TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS payee_zip TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS purpose TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS category TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS disbursement_date DATE`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS cycle INTEGER`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS transaction_id TEXT`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'fec_schedule_b'`);
  await pool.query(`ALTER TABLE vendor_fec_spend ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendor_fec_spend_vendor ON vendor_fec_spend(vendor_name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendor_fec_spend_state ON vendor_fec_spend(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendor_fec_spend_cycle ON vendor_fec_spend(cycle)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendor_fec_spend_category ON vendor_fec_spend(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendor_fec_spend_transaction ON vendor_fec_spend(transaction_id)`);
}

function buildFecScheduleBUrl({ cycle = DEFAULT_CYCLE, state = "", q = "", category = "", limit = 100 }) {
  const url = new URL(`${FEC_API_BASE_URL}/schedules/schedule_b/`);

  url.searchParams.set("api_key", FEC_API_KEY);
  url.searchParams.set("two_year_transaction_period", String(cycle));
  url.searchParams.set("cycle", String(cycle));
  url.searchParams.set("per_page", String(Math.min(Number(limit) || 100, 100)));
  url.searchParams.set("sort", "-disbursement_amount");
  url.searchParams.set("sort_hide_null", "true");

  if (state) {
    url.searchParams.set("recipient_state", normalizeState(state));
  }

  if (q) {
    url.searchParams.set("recipient_name", text(q));
  }

  if (category) {
    url.searchParams.set("disbursement_description", text(category));
  }

  return url;
}

async function fetchFecVendorSpend(query = {}) {
  if (!FEC_API_KEY) {
    return {
      ok: false,
      reason: "Missing FEC_API_KEY",
      rows: [],
    };
  }

  const url = buildFecScheduleBUrl(query);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "VoterSpheres Vendor Intelligence",
    },
  });

  const raw = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      reason: `FEC Schedule B request failed ${response.status}: ${raw.slice(0, 500)}`,
      rows: [],
    };
  }

  const payload = raw ? JSON.parse(raw) : {};

  return {
    ok: true,
    rows: Array.isArray(payload.results) ? payload.results : [],
    pagination: payload.pagination || null,
  };
}

function normalizeFecSpendRows(rows = [], cycle = DEFAULT_CYCLE) {
  return rows
    .map((row, index) => {
      const vendorName = text(
        row.recipient_name ||
          row.payee_name ||
          row.disbursement_recipient_name ||
          row.entity_name ||
          "Unknown Vendor"
      );

      const purpose = text(
        row.disbursement_description ||
          row.memo_text ||
          row.category ||
          "Campaign operating expenditure"
      );

      const committeeName = text(
        row.committee?.name ||
          row.committee_name ||
          row.committee?.committee_name ||
          "Unknown Committee"
      );

      const committeeId = text(
        row.committee_id ||
          row.committee?.committee_id ||
          ""
      );

      const payeeState = normalizeState(
        row.recipient_state ||
          row.payee_state ||
          row.disbursement_recipient_state ||
          ""
      );

      const state = payeeState || normalizeState(row.state || "");

      return {
        vendor_name: vendorName,
        payee_name: vendorName,
        committee_id: committeeId,
        committee_name: committeeName,
        state,
        payee_state: payeeState,
        payee_city: text(
          row.recipient_city ||
            row.payee_city ||
            row.disbursement_recipient_city ||
            ""
        ),
        payee_zip: text(
          row.recipient_zip ||
            row.payee_zip ||
            row.disbursement_recipient_zip ||
            ""
        ),
        purpose,
        category: inferVendorCategory(purpose, vendorName),
        amount: money(row.disbursement_amount || row.amount || 0),
        disbursement_date:
          row.disbursement_date ||
          row.expenditure_date ||
          row.report_year ||
          null,
        cycle: Number(row.two_year_transaction_period || row.cycle || cycle),
        transaction_id: text(
          row.sub_id ||
            row.transaction_id ||
            row.file_number ||
            `${vendorName}-${committeeId}-${index}`
        ),
      };
    })
    .filter((row) => row.vendor_name && row.vendor_name !== "Unknown Vendor");
}

async function upsertVendorSpend(rows = []) {
  if (!rows.length) return;

  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO vendor_fec_spend (
          vendor_name,
          payee_name,
          committee_id,
          committee_name,
          state,
          payee_state,
          payee_city,
          payee_zip,
          purpose,
          category,
          amount,
          disbursement_date,
          cycle,
          transaction_id,
          source,
          source_updated_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, NULLIF($12, '')::date, $13,
          $14, 'fec_schedule_b', NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
      `,
      [
        row.vendor_name,
        row.payee_name,
        row.committee_id,
        row.committee_name,
        row.state,
        row.payee_state,
        row.payee_city,
        row.payee_zip,
        row.purpose,
        row.category,
        row.amount,
        row.disbursement_date || "",
        row.cycle,
        row.transaction_id,
      ]
    );
  }
}

async function syncFecVendorSpend(req) {
  const query = req.query || {};
  const fec = await fetchFecVendorSpend(query);

  if (!fec.ok) return fec;

  const cycle = Number(query.cycle || DEFAULT_CYCLE);
  const rows = normalizeFecSpendRows(fec.rows, cycle);

  await upsertVendorSpend(rows);

  return {
    ok: true,
    imported: rows.length,
    pagination: fec.pagination,
  };
}

function getWhereSql() {
  return `
    WHERE
      ($1 = '' OR COALESCE(state, '') = $1 OR COALESCE(payee_state, '') = $1)
      AND ($2 = '' OR (
        COALESCE(vendor_name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(payee_name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(committee_name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(purpose, '') ILIKE '%' || $2 || '%'
        OR COALESCE(category, '') ILIKE '%' || $2 || '%'
      ))
      AND ($3 = '' OR COALESCE(category, '') = $3)
      AND ($4 = 0 OR COALESCE(cycle, 0) = $4)
  `;
}

router.get("/health", async (_req, res) => {
  try {
    await ensureVendorFecTables();

    res.json({
      ok: true,
      service: "vendor-fec",
      fec_configured: Boolean(FEC_API_KEY),
      source: "FEC Schedule B operating expenditures",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Vendor FEC health check failed",
    });
  }
});

router.post("/sync", async (req, res) => {
  try {
    await ensureVendorFecTables();

    const result = await syncFecVendorSpend(req);

    res.json(result);
  } catch (error) {
    console.error("Vendor FEC sync failed:", error);
    res.status(500).json({
      error: error.message || "Failed to sync FEC vendor spending",
    });
  }
});

router.get("/spend", async (req, res) => {
  try {
    await ensureVendorFecTables();

    if (String(req.query.live || "1") !== "0") {
      await syncFecVendorSpend(req);
    }

    const {
      state = "",
      q = "",
      category = "",
      cycle = DEFAULT_CYCLE,
      limit = 100,
    } = req.query;

    const values = [
      normalizeState(state),
      text(q),
      text(category),
      Number(cycle || 0),
      safeLimit(limit, 100, 250),
    ];

    const whereSql = getWhereSql();

    const vendorResult = await pool.query(
      `
        SELECT
          vendor_name,
          MIN(payee_name) AS payee_name,
          COALESCE(MAX(state), MAX(payee_state), 'National') AS state,
          COALESCE(MAX(category), 'Campaign Operations') AS category,
          COALESCE(SUM(amount), 0)::numeric AS contract_value,
          COUNT(*)::int AS transaction_count,
          COUNT(DISTINCT committee_id)::int AS committee_count,
          COUNT(DISTINCT state)::int AS state_count,
          MAX(disbursement_date) AS last_spend_date,
          MAX(source_updated_at) AS source_updated_at,
          'fec_schedule_b' AS source,
          STRING_AGG(DISTINCT committee_name, ', ' ORDER BY committee_name) AS committee_clients,
          STRING_AGG(DISTINCT purpose, '; ' ORDER BY purpose) AS services
        FROM vendor_fec_spend
        ${whereSql}
        GROUP BY vendor_name
        ORDER BY contract_value DESC, vendor_name ASC
        LIMIT $5
      `,
      values
    );

    const categoryResult = await pool.query(
      `
        SELECT
          COALESCE(category, 'Campaign Operations') AS category,
          COUNT(DISTINCT vendor_name)::int AS vendor_count,
          COUNT(*)::int AS transaction_count,
          COALESCE(SUM(amount), 0)::numeric AS total_amount
        FROM vendor_fec_spend
        ${whereSql}
        GROUP BY category
        ORDER BY total_amount DESC
        LIMIT 20
      `,
      values.slice(0, 4)
    );

    const stateResult = await pool.query(
      `
        SELECT
          COALESCE(state, payee_state, 'National') AS state,
          COUNT(DISTINCT vendor_name)::int AS vendor_count,
          COUNT(*)::int AS transaction_count,
          COALESCE(SUM(amount), 0)::numeric AS total_amount
        FROM vendor_fec_spend
        ${whereSql}
        GROUP BY COALESCE(state, payee_state, 'National')
        ORDER BY total_amount DESC
        LIMIT 50
      `,
      values.slice(0, 4)
    );

    const committeeResult = await pool.query(
      `
        SELECT
          committee_id,
          COALESCE(committee_name, 'Unknown Committee') AS committee_name,
          COUNT(DISTINCT vendor_name)::int AS vendor_count,
          COUNT(*)::int AS transaction_count,
          COALESCE(SUM(amount), 0)::numeric AS total_amount
        FROM vendor_fec_spend
        ${whereSql}
        GROUP BY committee_id, committee_name
        ORDER BY total_amount DESC
        LIMIT 25
      `,
      values.slice(0, 4)
    );

    const results = vendorResult.rows.map((row, index) => {
      const score = performanceFromSpend(
        row.contract_value,
        row.transaction_count,
        row.state_count
      );

      return {
        id: `fec-vendor-${index}-${row.vendor_name}`,
        vendor_id: `fec-vendor-${index}`,
        name: row.vendor_name,
        vendor_name: row.vendor_name,
        state: row.state,
        primary_state: row.state,
        category: row.category,
        services: row.services || "FEC operating expenditure vendor",
        description: row.services || "FEC operating expenditure vendor",
        contract_value: Number(row.contract_value || 0),
        transaction_count: Number(row.transaction_count || 0),
        committee_count: Number(row.committee_count || 0),
        state_count: Number(row.state_count || 0),
        last_spend_date: row.last_spend_date,
        source_updated_at: row.source_updated_at,
        source: row.source,
        status: inferStatus(row.last_spend_date),
        committee_clients: row.committee_clients,
        overall_score: score,
        on_time_score: Math.max(45, Math.min(98, score + 4)),
        reliability_score: Math.max(45, Math.min(98, score + 2)),
        risk_score: riskFromSpend(row.contract_value, row.transaction_count),
        total_jobs: Number(row.transaction_count || 0),
        delayed_jobs:
          score < 70
            ? Math.max(1, Math.round(Number(row.transaction_count || 0) * 0.08))
            : 0,
      };
    });

    const highSpendStates = stateResult.rows
      .filter((row) => Number(row.total_amount || 0) >= 100000)
      .length;

    const mediumSpendStates = stateResult.rows
      .filter(
        (row) =>
          Number(row.total_amount || 0) >= 25000 &&
          Number(row.total_amount || 0) < 100000
      )
      .length;

    const gaps = stateResult.rows
      .filter(
        (row) =>
          Number(row.vendor_count || 0) < 3 ||
          Number(row.total_amount || 0) < 25000
      )
      .slice(0, 8)
      .map((row) => ({
        title: `${row.state || "State"} vendor coverage requires review`,
        detail: `${row.vendor_count || 0} FEC-derived vendors and ${Number(
          row.transaction_count || 0
        )} spend records are visible for this state.`,
        state: row.state || "National",
        severity: Number(row.vendor_count || 0) < 2 ? "High" : "Medium",
        coverage_score: Math.min(100, Number(row.vendor_count || 0) * 20),
      }));

    const recommended_actions = gaps.slice(0, 6).map((gap) => ({
      title: `Expand vendor coverage in ${gap.state}`,
      detail: gap.detail,
      state: gap.state,
      priority: gap.severity === "High" ? "High" : "Medium",
      owner: "Operations",
      due: gap.severity === "High" ? "Today" : "This Week",
    }));

    res.json({
      results,
      vendors: results,
      rows: results,

      categories: categoryResult.rows.map((row) => ({
        ...row,
        total_amount: Number(row.total_amount || 0),
      })),

      states: stateResult.rows.map((row) => ({
        ...row,
        total_amount: Number(row.total_amount || 0),
      })),

      committees: committeeResult.rows.map((row) => ({
        ...row,
        total_amount: Number(row.total_amount || 0),
      })),

      performance: results,

      performanceSummary: {
        strong_vendors: results.filter((row) => Number(row.overall_score || 0) >= 85).length,
        risk_vendors: results.filter((row) => Number(row.overall_score || 0) < 70).length,
      },

      intel: {
        summary: {
          total_vendors: results.length,
          active_vendors: results.filter((row) => row.status === "active").length,
          states_covered: stateResult.rows.length,
          categories_covered: categoryResult.rows.length,
          high_gap_states: highSpendStates,
          medium_gap_states: mediumSpendStates,
          resolved_gap_states: 0,
        },
        gaps,
        resolved_gaps: [],
        recommended_actions,
      },

      summary: {
        total_vendors: results.length,
        active_vendors: results.filter((row) => row.status === "active").length,
        states_covered: stateResult.rows.length,
        categories_covered: categoryResult.rows.length,
        total_spend: results.reduce(
          (sum, row) => sum + Number(row.contract_value || 0),
          0
        ),
        source: "FEC Schedule B operating expenditures",
      },

      _live_fec: true,
    });
  } catch (error) {
    console.error("Vendor FEC spend failed:", error);
    res.status(500).json({
      error: error.message || "Failed to load FEC vendor spending",
    });
  }
});

export default router;
