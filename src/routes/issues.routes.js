import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/:state", async (req, res) => {

  const { state } = req.params;

  try {

    const result = await pool.query(
      `
      SELECT issue,
      AVG(sentiment_score) as sentiment
      FROM voter_issues
      WHERE state = $1
      GROUP BY issue
      ORDER BY sentiment DESC
      `,
      [state]
    );

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error:"Failed to fetch issue sentiment"
    });

  }

});


export default router;
