import express from "express";
import {
  getIntelligenceSummary,
  getIntelligenceDashboard,
  getIntelligenceForecast,
  getIntelligenceRankings,
  getIntelligenceMap,
  getLiveFundraising,
  getFundraisingLeaderboard,
  runManualFundraisingIngestion
} from "../services/intelligence.service.js";

const router = express.Router();

router.get("/summary", getIntelligenceSummary);
router.get("/dashboard", getIntelligenceDashboard);
router.get("/forecast", getIntelligenceForecast);
router.get("/rankings", getIntelligenceRankings);
router.get("/map", getIntelligenceMap);

router.get("/fundraising/live", getLiveFundraising);
router.get("/fundraising/leaderboard", getFundraisingLeaderboard);
router.post("/fundraising/ingest", runManualFundraisingIngestion);

export default router;
