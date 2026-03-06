import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/:state/:district", async (req, res) => {

  const { state, district } = req.params;

  try {

    const result = await pool.query(`
      SELECT *
      FROM district_analytics
      WHERE state = $1
      AND district = $2
    `,[state,district]);

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Failed to load district data"
    });

  }

});

export default router;
