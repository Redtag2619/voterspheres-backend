import express from "express";
import pool from "../db.js";

const router = express.Router();


router.get("/candidate/:candidateId", async (req,res)=>{

  const {candidateId} = req.params;

  try{

    const result = await pool.query(
      `
      SELECT message,effectiveness_score
      FROM campaign_messages
      WHERE candidate_id = $1
      ORDER BY effectiveness_score DESC
      `,
      [candidateId]
    );

    res.json(result.rows);

  }catch(error){

    console.error(error);

    res.status(500).json({
      error:"Failed to fetch messaging intelligence"
    });

  }

});


export default router;
