import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/", async (req, res) => {

  const { state, party, office, page = 1, limit = 20 } = req.query;

  const offset = (page - 1) * limit;

  try {

    let query = `
      SELECT *
      FROM candidates
      WHERE 1=1
    `;

    const params = [];

    if (state) {
      params.push(state);
      query += ` AND state = $${params.length}`;
    }

    if (party) {
      params.push(party);
      query += ` AND party = $${params.length}`;
    }

    if (office) {
      params.push(office);
      query += ` AND office = $${params.length}`;
    }

    params.push(limit);
    params.push(offset);

    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    res.json({
      results: result.rows,
      count: result.rowCount
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch candidates" });
  }

});


export default router;
