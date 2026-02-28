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

    const offset = (Number(page) - 1) * Number(limit);

    const conditions = [];
    const values = [];
    let index = 1;

    if (q) {
      conditions.push(`full_name ILIKE $${index++}`);
      values.push(`%${q}%`);
    }

    if (state) {
      conditions.push(`state = $${index++}`);
      values.push(state);
    }

    if (county) {
      conditions.push(`county = $${index++}`);
      values.push(county);
    }

    if (office) {
      conditions.push(`office = $${index++}`);
      values.push(office);
    }

    if (party) {
      conditions.push(`party = $${index++}`);
      values.push(party);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const dataQuery = `
      SELECT *
      FROM voters
      ${whereClause}
      ORDER BY full_name ASC
      LIMIT $${index++}
      OFFSET $${index}
    `;

    values.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) FROM voters ${whereClause}
    `;

    const dataResult = await pool.query(dataQuery, values);
    const countResult = await pool.query(
      countQuery,
      values.slice(0, values.length - 2)
    );

    res.json({
      results: dataResult.rows,
      total: Number(countResult.rows[0].count),
    });
  } catch (err) {
    console.error("Candidates error:", err);
    res.status(500).json({
      results: [],
      total: 0,
    });
  }
});

export default router;
