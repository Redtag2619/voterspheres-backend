import express from "express";
import { requireEnterprise } from "../middleware/requirePlan.js";
import {
  getFundraisingLeaderboard,
  getFundraisingSummary,
} from "../services/fecIngestion.service.js";

const router = express.Router();

router.get("/fundraising/leaderboard", requireEnterprise, getFundraisingLeaderboard);
router.get("/fundraising/summary", requireEnterprise, getFundraisingSummary);

export default router;
