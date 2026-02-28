import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Helper: Safe Array Response
|--------------------------------------------------------------------------
*/
const safeQuery = async (res, query) => {
  try {
    const result = await pool.query(query);
    return res.json(result.rows || []);
  } catch (err) {
    console.error("Dropdown error:", err);
    return res.json([]); // Always return array to prevent frontend crash
  }
};

/*
|--------------------------------------------------------------------------
| States
|--------------------------------------------------------------------------
*/
router.get("/states", async (req, res) => {
  await safeQuery(
    res,
    "SELECT DISTINCT state FROM voters WHERE state IS NOT NULL ORDER BY state ASC"
  );
});

/*
|--------------------------------------------------------------------------
| Offices
|--------------------------------------------------------------------------
*/
router.get("/offices", async (req, res) => {
  await safeQuery(
    res,
    "SELECT DISTINCT office FROM voters WHERE office IS NOT NULL ORDER BY office ASC"
  );
});

/*
|--------------------------------------------------------------------------
| Parties
|--------------------------------------------------------------------------
*/
router.get("/parties", async (req, res) => {
  await safeQuery(
    res,
    "SELECT DISTINCT party FROM voters WHERE party IS NOT NULL ORDER BY party ASC"
  );
});

export default router;
