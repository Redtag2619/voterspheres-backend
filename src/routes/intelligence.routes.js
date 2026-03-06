import express from "express";
import pool from "../db.js";

const router = express.Router();

/*
----------------------------------
CAMPAIGNS
----------------------------------
*/

router.get("/campaigns", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM campaigns ORDER BY election_year DESC LIMIT 100"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load campaigns" });
  }
});


/*
----------------------------------
CONSULTANTS
----------------------------------
*/

router.get("/consultants", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM consultants ORDER BY firm_name ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load consultants" });
  }
});


/*
----------------------------------
DISTRICT ANALYTICS
----------------------------------
*/

router.get("/districts", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM district_analytics ORDER BY competitiveness_score DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load district analytics" });
  }
});


/*
----------------------------------
CAMPAIGN SPENDING
----------------------------------
*/

router.get("/spending", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM campaign_spending ORDER BY election_year DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load campaign spending" });
  }
});

export default router;
