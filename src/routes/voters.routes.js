import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/", async (req, res) => {

  const { state, county, party } = req.query;

  try {

    let query = `
      SELECT *
      FROM voters
      WHERE 1=1
    `;

    const params = [];

    if (state) {
      params.push(state);
      query += ` AND state = $${params.length}`;
    }

    if (county) {
      params.push(county);
      query += ` AND county = $${params.length}`;
    }

    if (party) {
      params.push(party);
      query += ` AND party = $${params.length}`;
    }

    const result = await pool.query(query, params);

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch voters" });
  }

});


export default router;
