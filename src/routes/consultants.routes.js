import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/:consultantId/campaigns", async (req, res) => {

  const { consultantId } = req.params;

  try {

    const result = await pool.query(
      `
      SELECT
        c.id,
        c.name,
        c.office,
        c.state,
        c.party
      FROM candidates c
      JOIN consultant_campaigns cc
      ON c.id = cc.candidate_id
      WHERE cc.consultant_id = $1
      `,
      [consultantId]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch consultant campaigns" });
  }

});

export default router;
