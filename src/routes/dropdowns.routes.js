import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ================================
   STATES
================================ */

router.get("/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      WHERE state IS NOT NULL
      ORDER BY state
    `);

    res.json(result.rows.map(r => r.state));

  } catch (err) {
    console.error("States dropdown error:", err);
    res.status(500).json({ error: "Failed to load states" });
  }
});


/* ================================
   PARTIES
================================ */

router.get("/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT party
      FROM candidates
      WHERE party IS NOT NULL
      ORDER BY party
    `);

    res.json(result.rows.map(r => r.party));

  } catch (err) {
    console.error("Parties dropdown error:", err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});


/* ================================
   OFFICES
================================ */

router.get("/offices", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT election
      FROM candidates
      WHERE election IS NOT NULL
      ORDER BY election
    `);

    res.json(result.rows.map(r => r.election));

  } catch (err) {
    console.error("Offices dropdown error:", err);
    res.status(500).json({ error: "Failed to load offices" });
  }
});


export default router;
