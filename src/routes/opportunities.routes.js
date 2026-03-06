import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT 
        d.state,
        d.district,
        d.office,
        d.competitiveness_score,
        d.last_margin,
        d.incumbent_party,
        CASE
          WHEN d.last_margin < 3 THEN '🔥 HIGH OPPORTUNITY'
          WHEN d.last_margin < 7 THEN 'Competitive'
          ELSE 'Low'
        END as opportunity_level
      FROM district_analytics d
      ORDER BY d.last_margin ASC
      LIMIT 50
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Failed to load opportunities"
    });

  }
});

export default router;
