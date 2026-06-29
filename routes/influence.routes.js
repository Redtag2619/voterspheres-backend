import express from "express";

import {
  influenceAlerts,
  influenceEntity,
  influenceHealth,
  influenceRankings,
  influenceState,
  influenceSummary,
  syncInfluence,
  influenceForecast,
  influenceForecastHealth,
  influenceMomentum,
  influenceOpportunities,
  influenceRisk,
  recalculateInfluence,
} from "../controllers/influence.controller.js";

const router = express.Router();

router.get("/health", influenceHealth);
router.get("/summary", influenceSummary);
router.get("/rankings", influenceRankings);
router.get("/state/:state", influenceState);
router.get("/entity", influenceEntity);
router.get("/alerts", influenceAlerts);
router.get("/forecast/health", influenceForecastHealth);
router.get("/forecast", influenceForecast);
router.get("/predictions", influenceForecast);
router.get("/opportunities", influenceOpportunities);
router.get("/risk", influenceRisk);
router.get("/momentum", influenceMomentum);

router.post("/recalculate", recalculateInfluence);

router.post("/sync", syncInfluence);

export default router;
