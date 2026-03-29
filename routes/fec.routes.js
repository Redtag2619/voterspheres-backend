import express from "express";
import { requireEnterprise } from "../middleware/requirePlan.js";
import {
  getFundraisingLeaderboard,
  getLiveFundraising,
} from "../services/intelligence.service.js";

const router = express.Router();

router.get("/fundraising/live", requireEnterprise, getLiveFundraising);
router.get("/fundraising/leaderboard", requireEnterprise, getFundraisingLeaderboard);

export default router;
