const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust if your db file path differs

/* ============================================================
   GET /candidates
   Public Search Endpoint (NO AUTH)
============================================================ */

router.get("/", async (req, res) => {
  try {
    const {
      q,
      state,
      county,
      office,
      party,
      page = 1,
      limit = 10,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const values = [];
    let whereClauses = [];

    if (q) {
      values.push(`%${q}%`);
      whereClauses.push(`full_name ILIKE $${values.length}`);
    }

    if (state) {
      values.push(state);
      whereClauses.push(`state_name = $${values.length}`);
    }

    if (county) {
      values.push(county);
      whereClauses.push(`county_name = $${values.length}`);
    }

    if (office) {
      values.push(office);
      whereClauses.push(`office_name = $${values.length}`);
    }

    if (party) {
      values.push(party);
      whereClauses.push(`party_name = $${values.length}`);
    }

    const whereSQL =
      whereClauses.length > 0
        ? `WHERE ${whereClauses.join(" AND ")}`
        : "";

    // Total count query
    const totalQuery = `
      SELECT COUNT(*) 
      FROM candidates
      ${whereSQL}
    `;

    const totalResult = await pool.query(totalQuery, values);
    const total = Number(totalResult.rows[0].count);

    // Data query
    values.push(limit);
    values.push(offset);

    const dataQuery = `
      SELECT *
      FROM candidates
      ${whereSQL}
      ORDER BY full_name ASC
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
   Public Dropdown
============================================================ */

router.get("/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state_name AS state
      FROM candidates
      WHERE state_name IS NOT NULL
      ORDER BY state_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("States fetch error:", err);
    res.status(500).json({ error: "Failed to load states" });
  }
});

/* ============================================================
   GET /candidates/offices
============================================================ */

router.get("/offices", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT office_name AS office
      FROM candidates
      WHERE office_name IS NOT NULL
      ORDER BY office_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Offices fetch error:", err);
    res.status(500).json({ error: "Failed to load offices" });
  }
});

/* ============================================================
   GET /candidates/parties
============================================================ */

router.get("/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT party_name AS party
      FROM candidates
      WHERE party_name IS NOT NULL
      ORDER BY party_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Parties fetch error:", err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});

module.exports = router;
