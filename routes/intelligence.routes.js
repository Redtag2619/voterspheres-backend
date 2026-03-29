import express from "express";
import { requirePro, requireEnterprise } from "../middleware/requirePlan.js";
import {
  getIntelligenceSummary,
  getIntelligenceDashboard,
  getIntelligenceForecast,
  getIntelligenceRankings,
  getIntelligenceMap,
  getLiveFundraising,
  getFundraisingLeaderboard,
  runManualFundraisingIngestion,
} from "../services/intelligence.service.js";

const router = express.Router();

router.get("/summary", getIntelligenceSummary);
router.get("/dashboard", getIntelligenceDashboard);

router.get("/forecast", requirePro, getIntelligenceForecast);
router.get("/rankings", requirePro, getIntelligenceRankings);
router.get("/map", requirePro, getIntelligenceMap);

router.get("/fundraising/live", requireEnterprise, getLiveFundraising);
router.get("/fundraising/leaderboard", requireEnterprise, getFundraisingLeaderboard);

router.post("/fundraising/ingest", requireEnterprise, runManualFundraisingIngestion);

export default router;
