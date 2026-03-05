import express from "express";
import pool from "../db.js";

const router = express.Router();

/* =====================================================
   GET /candidates
===================================================== */

router.get("/", async (req, res) => {
  try {
    const {
      q,
      state,
      party,
      page = 1,
      limit = 10
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const values = [];
    const filters = [];

    if (q) {
      values.push(`%${q}%`);
      filters.push(`name ILIKE $${values.length}`);
    }

    if (state) {
      values.push(state);
      filters.push(`state = $${values.length}`);
    }

    if (party) {
      values.push(party);
      filters.push(`party = $${values.length}`);
    }

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const totalQuery = `
      SELECT COUNT(*)
      FROM candidates
      ${whereClause}
    `;

    const totalResult = await pool.query(totalQuery, values);
    const total = Number(totalResult.rows[0].count);

    values.push(limit);
    values.push(offset);

    const dataQuery = `
      SELECT *
      FROM candidates
      ${whereClause}
      ORDER BY name ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `;

    const result = await pool.query(dataQuery, values);

    res.json({
      results: result.rows,
      total
    });

  } catch (err) {
    console.error("Candidates fetch error:", err);
    res.status(500).json({ error: "Failed to load candidates" });
  }
});


/* =====================================================
   DROPDOWN ROUTES
   These match your frontend requests
===================================================== */

/* STATES */

router.get("/dropdowns/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      WHERE state IS NOT NULL
      ORDER BY state ASC
    `);

    res.json(result.rows.map(r => r.state));

  } catch (err) {
    console.error("States dropdown error:", err);
    res.status(500).json({ error: "Failed to load states" });
  }
});


/* PARTIES */

router.get("/dropdowns/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT party
      FROM candidates
      WHERE party IS NOT NULL
      ORDER BY party ASC
    `);

    res.json(result.rows.map(r => r.party));

  } catch (err) {
    console.error("Parties dropdown error:", err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});


/* OFFICES (fallback if column missing) */

router.get("/dropdowns/offices", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT DISTINCT election
      FROM candidates
      WHERE election IS NOT NULL
      ORDER BY election ASC
    `);

    res.json(result.rows.map(r => r.election));

  } catch (err) {
    console.error("Offices dropdown error:", err);
    res.status(500).json({ error: "Failed to load offices" });
  }
});


export default router;
