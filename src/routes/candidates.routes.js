import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ============================================================
   GET /candidates
   Matches your actual table structure
============================================================ */

router.get("/", async (req, res) => {
  try {
    const {
      q,
      state,
      party,
      page = 1,
      limit = 10,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const values = [];
    let whereClauses = [];

    if (q) {
      values.push(`%${q}%`);
      whereClauses.push(`name ILIKE $${values.length}`);
    }

    if (state) {
      values.push(state);
      whereClauses.push(`state = $${values.length}`);
    }

    if (party) {
      values.push(party);
      whereClauses.push(`party = $${values.length}`);
    }

    const whereSQL =
      whereClauses.length > 0
        ? `WHERE ${whereClauses.join(" AND ")}`
        : "";

    // Get total count
    const totalQuery = `
      SELECT COUNT(*)
      FROM candidates
      ${whereSQL}
    `;

    const totalResult = await pool.query(totalQuery, values);
    const total = Number(totalResult.rows[0].count);

    // Add pagination
    values.push(limit);
    values.push(offset);

    const dataQuery = `
      SELECT *
      FROM candidates
      ${whereSQL}
      ORDER BY name ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `;

    const result = await pool.query(dataQuery, values);

    res.json({
      results: result.rows,
      total,
    });

  } catch (err) {
    console.error("Candidates fetch error:", err);
    res.status(500).json({ error: "Failed to load candidates" });
  }
});

/* ============================================================
   GET /candidates/states
============================================================ */

router.get("/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      WHERE state IS NOT NULL
      ORDER BY state ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("States fetch error:", err);
    res.status(500).json({ error: "Failed to load states" });
  }
});

/* ============================================================
   GET /candidates/parties
============================================================ */

router.get("/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT party
      FROM candidates
      WHERE party IS NOT NULL
      ORDER BY party ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Parties fetch error:", err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});

export default router;
