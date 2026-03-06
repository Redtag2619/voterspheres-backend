import express from "express";
import pool from "../db.js";

const router = express.Router();


/*
GET ALL ELECTIONS
*/
router.get("/", async (req, res) => {

  const { year, state } = req.query;

  try {

    let query = `SELECT * FROM elections WHERE 1=1`;
    const values = [];

    if (year) {
      values.push(year);
      query += ` AND year = $${values.length}`;
    }

    if (state) {
      values.push(state);
      query += ` AND state = $${values.length}`;
    }

    query += ` ORDER BY election_date ASC`;

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch elections" });
  }

});


/*
CREATE ELECTION
*/
router.post("/", async (req, res) => {

  const { year, state, office, district, election_date } = req.body;

  try {

    const result = await pool.query(
      `INSERT INTO elections (year,state,office,district,election_date)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [year,state,office,district,election_date]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create election" });
  }

});

export default router;
