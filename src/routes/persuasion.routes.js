import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/targets/:candidateId", async (req, res) => {

  const { candidateId } = req.params;

  try {

    const result = await pool.query(
      `
      SELECT
        demographic_group,
        AVG(persuasion_score) AS persuasion_score
      FROM voter_intelligence
      WHERE candidate_id = $1
      GROUP BY demographic_group
      ORDER BY persuasion_score DESC
      LIMIT 5
      `,
      [candidateId]
    );

    res.json({
      candidate_id: candidateId,
      top_targets: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to calculate persuasion targets" });
  }

});

export default router;
