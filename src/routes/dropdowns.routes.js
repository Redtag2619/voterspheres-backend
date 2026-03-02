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
      SELECT DISTINCT state AS state
      FROM candidates
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("States dropdown error:", err);
    res.status(500).json([]);
  }
});

/*
|--------------------------------------------------------------------------
| GET /dropdowns/offices
|--------------------------------------------------------------------------
*/
router.get("/offices", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT election AS office
      FROM candidates
      WHERE election IS NOT NULL AND election <> ''
      ORDER BY election ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Offices dropdown error:", err);
    res.status(500).json([]);
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
      SELECT DISTINCT party AS party
      FROM candidates
      WHERE party IS NOT NULL AND party <> ''
      ORDER BY party ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Parties dropdown error:", err);
    res.status(500).json([]);
  }
});

export default router;
