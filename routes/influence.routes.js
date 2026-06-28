import express from "express";

import {
  influenceAlerts,
  influenceEntity,
  influenceHealth,
  influenceRankings,
  influenceState,
  influenceSummary,
  syncInfluence,
} from "../controllers/influence.controller.js";

const router = express.Router();

router.get("/health", influenceHealth);
router.get("/summary", influenceSummary);
router.get("/rankings", influenceRankings);
router.get("/state/:state", influenceState);
router.get("/entity", influenceEntity);
router.get("/alerts", influenceAlerts);

router.post("/sync", syncInfluence);

export default router;
