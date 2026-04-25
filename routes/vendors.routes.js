import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

const router = express.Router();

/* --------------------------
   Helpers
-------------------------- */

function text(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  const v = text(value);
  return v.length === 2 ? v.toUpperCase() : v;
}

/* --------------------------
   STATES
-------------------------- */
router.get("/states", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT state
      FROM vendors
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    res.json({
      results: rows.map(r => r.state),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load states" });
  }
});

/* --------------------------
   DROPDOWNS
-------------------------- */
router.get("/dropdowns/categories", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT category
      FROM vendors
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category ASC
    `);

    res.json({
      results: rows.map(r => r.category),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed categories" });
  }
});

router.get("/dropdowns/statuses", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT status
      FROM vendors
      WHERE status IS NOT NULL AND status <> ''
      ORDER BY status ASC
    `);

    res.json({
      results: rows.map(r => r.status),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed statuses" });
  }
});

/* --------------------------
   MAIN LIST
-------------------------- */
router.get("/", requireAuth, async (req, res) => {
  try {
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
          OR COALESCE(services, '') ILIKE '%' || $1 || '%'
        ))
        AND ($2 = '' OR UPPER(COALESCE(state,'')) = $2)
        AND ($3 = '' OR COALESCE(category,'') = $3)
        AND ($4 = '' OR COALESCE(status,'') = $4)
    `;

    const data = await pool.query(
      `
      SELECT *,
        CASE
          WHEN LOWER(COALESCE(status,'')) = 'active' THEN 'Monitor'
          ELSE 'Watch'
        END AS risk
      FROM vendors
      ${whereSql}
      ORDER BY COALESCE(vendor_name,name,'zzz')
      LIMIT $5 OFFSET $6
      `,
      values
    );

    const total = await pool.query(
      `SELECT COUNT(*)::int FROM vendors ${whereSql}`,
      values.slice(0, 4)
    );

    res.json({
      total: total.rows[0]?.count || 0,
      page: safePage,
      limit: safeLimit,
      results: data.rows,
      _live: true
    });

  } catch (err) {
    res.status(500).json({ error: err.message || "Failed vendors" });
  }
});

/* --------------------------
   IMPORT (ADMIN ONLY)
-------------------------- */
router.post("/import", requireAuth, requireRoles("admin"), async (_req, res) => {
  try {
    res.json({
      ok: true,
      message: "Import endpoint ready (hook ingestion service next)"
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Import failed" });
  }
});

export default router;
