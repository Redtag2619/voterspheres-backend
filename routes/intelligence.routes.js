import express from "express";
import { requirePro, requireEnterprise } from "../middleware/requirePlan.js";
import {
  getMapIntelligence,
  getForecastOverlays,
  getFundraisingLeaderboard,
  getPowerRankings,
} from "../services/intelligence.service.js";

const router = express.Router();

router.get("/map", getMapIntelligence);

router.get("/forecast/overlays", requirePro, getForecastOverlays);
router.get("/rankings", requirePro, getPowerRankings);

router.get(
  "/fundraising/leaderboard",
  requireEnterprise,
  getFundraisingLeaderboard
);

export default router;
