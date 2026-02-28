import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| States
|--------------------------------------------------------------------------
*/
router.get("/states", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT state FROM voters ORDER BY state ASC"
    );

    res.json(result.rows);
  } catch (err) {
    console.error("States dropdown error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/*
|--------------------------------------------------------------------------
| Offices
|--------------------------------------------------------------------------
*/
router.get("/offices", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT office FROM voters ORDER BY office ASC"
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Offices dropdown error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/*
|--------------------------------------------------------------------------
| Parties
|--------------------------------------------------------------------------
*/
router.get("/parties", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT party FROM voters ORDER BY party ASC"
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Parties dropdown error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
