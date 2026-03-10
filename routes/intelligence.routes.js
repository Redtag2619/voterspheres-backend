import express from "express";
import {
  getIntelligenceSummary,
  getIntelligenceDashboard,
  getIntelligenceForecast,
  getIntelligenceRankings,
  getIntelligenceMap
} from "../services/intelligence.service.js";

const router = express.Router();

router.get("/summary", getIntelligenceSummary);
router.get("/dashboard", getIntelligenceDashboard);
router.get("/forecast", getIntelligenceForecast);
router.get("/rankings", getIntelligenceRankings);
router.get("/map", getIntelligenceMap);

export default router;
