import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/prediction/:candidateId", async (req, res) => {

  const { candidateId } = req.params;

  try {

    const candidate = await pool.query(
      `SELECT * FROM candidates WHERE id = $1`,
      [candidateId]
    );

    if (candidate.rows.length === 0) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    const intelligence = await pool.query(
      `
      SELECT
        AVG(support_score) as support,
        AVG(persuasion_score) as persuasion,
        AVG(turnout_probability) as turnout
      FROM campaign_intelligence
      WHERE candidate_id = $1
      `,
      [candidateId]
    );

    const data = intelligence.rows[0];

    const winProbability =
      (Number(data.support || 0) +
        Number(data.persuasion || 0) +
        Number(data.turnout || 0)) / 300;

    res.json({
      candidate: candidate.rows[0].name,
      office: candidate.rows[0].office,
      state: candidate.rows[0].state,
      win_probability: winProbability
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Prediction failed" });
  }

});


export default router;
