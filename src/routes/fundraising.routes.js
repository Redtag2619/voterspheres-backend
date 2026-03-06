import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/race/:state/:office", async (req, res) => {

  const { state, office } = req.params;

  try {

    const result = await pool.query(
      `
      SELECT
        c.name,
        SUM(f.amount) AS total_raised
      FROM candidates c
      JOIN fundraising f
      ON c.id = f.candidate_id
      WHERE c.state = $1
      AND c.office = $2
      GROUP BY c.name
      ORDER BY total_raised DESC
      `,
      [state, office]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch fundraising data" });
  }

});

export default router;
