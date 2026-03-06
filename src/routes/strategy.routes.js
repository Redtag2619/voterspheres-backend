import express from "express";
import pool from "../db.js";

const router = express.Router();


/*
AI CAMPAIGN STRATEGY ENGINE
*/
router.get("/candidate/:candidateId", async (req,res)=>{

 const {candidateId} = req.params;

 try{

  // candidate info
  const candidate = await pool.query(
   `SELECT * FROM candidates WHERE id=$1`,
   [candidateId]
  );

  if(candidate.rows.length===0){
   return res.status(404).json({error:"Candidate not found"})
  }

  const state = candidate.rows[0].state

  // issue sentiment
  const issues = await pool.query(
   `
   SELECT issue, AVG(sentiment_score) as score
   FROM voter_issues
   WHERE state=$1
   GROUP BY issue
   ORDER BY score DESC
   LIMIT 1
   `,
   [state]
  );

  const topIssue = issues.rows[0]?.issue || "Economy"

  // fundraising strength
  const fundraising = await pool.query(
   `
   SELECT COALESCE(SUM(amount),0) as total
   FROM fundraising
   WHERE candidate_id=$1
   `,
   [candidateId]
  );

  const totalRaised = fundraising.rows[0].total

  let fundraisingStrength = 0.5

  if(totalRaised > 1000000) fundraisingStrength = 0.8
  if(totalRaised > 5000000) fundraisingStrength = 0.95

  // win probability model
  let winProbability = 0.45

  if(topIssue === "Economy") winProbability += 0.1
  if(fundraisingStrength > 0.8) winProbability += 0.1

  if(winProbability > 0.95) winProbability = 0.95

  const recommendedMessage =
   `Focus campaign messaging on ${topIssue} and economic stability. Target persuadable suburban voters.`

  const targetVoters =
   "Suburban voters, independents, and moderate party members."

  const strategy = {
   candidate_id:candidateId,
   win_probability:winProbability,
   top_issue:topIssue,
   target_voters:targetVoters,
   recommended_message:recommendedMessage,
   fundraising_strength:fundraisingStrength
  }

  res.json(strategy)

 }catch(error){

  console.error(error)

  res.status(500).json({
   error:"Strategy engine failed"
  })

 }

})


export default router
