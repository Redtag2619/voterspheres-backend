import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET /candidates
|--------------------------------------------------------------------------
*/
router.get("/", async (req, res) => {
  try {
    const {
      q = "",
      state = "",
      county = "",
      office = "",
      party = "",
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const values = [];
    let index = 1;

    if (q) {
      conditions.push(`name ILIKE $${index++}`);
      values.push(`%${q}%`);
    }

    if (state) {
      conditions.push(`state = $${index++}`);
      values.push(state);
    }

    if (party) {
      conditions.push(`party = $${index++}`);
      values.push(party);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const dataQuery = `
      SELECT
        id,
        name AS full_name,
        election AS office_name,
        '' AS county_name,
        state AS state_name,
        party AS party_name,
        '' AS email,
        '' AS phone,
        bio,
        photo,
        election_date,
        slug
      FROM candidates
      ${whereClause}
      ORDER BY name ASC
      LIMIT $${index++}
      OFFSET $${index}
    `;

    values.push(limitNum, offset);

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM candidates
      ${whereClause}
    `;

    const dataResult = await pool.query(dataQuery, values);
    const countResult = await pool.query(
      countQuery,
      values.slice(0, values.length - 2)
    );

    res.json({
      results: dataResult.rows,
      total: Number(countResult.rows[0].total),
    });
  } catch (err) {
    console.error("Candidates route error:", err);
    res.status(500).json({
      results: [],
      total: 0,
    });
  }
});

export default router;
