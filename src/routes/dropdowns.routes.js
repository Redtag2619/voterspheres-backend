import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET /dropdowns/states
|--------------------------------------------------------------------------
*/
router.get("/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    res.json(result.rows.map(r => r.state));
  } catch (err) {
    console.error("States dropdown error:", err);
    res.status(500).json({ error: err.message });
  }
});

/*
|--------------------------------------------------------------------------
| GET /dropdowns/parties
|--------------------------------------------------------------------------
*/
router.get("/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT party
      FROM candidates
      WHERE party IS NOT NULL AND party <> ''
      ORDER BY party ASC
    `);

    res.json(result.rows.map(r => r.party));
  } catch (err) {
    console.error("Parties dropdown error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
