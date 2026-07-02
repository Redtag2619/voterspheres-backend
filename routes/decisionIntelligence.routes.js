import express from "express";
import {
  getExecutiveDecisionIntelligence,
  seedExecutiveDecisionIntelligence,
  getExecutiveDecisionIntelligenceHealth,
} from "../controllers/decisionIntelligence.controller.js";

const router = express.Router();

router.get("/health", getExecutiveDecisionIntelligenceHealth);
router.get("/", getExecutiveDecisionIntelligence);
router.post("/seed", seedExecutiveDecisionIntelligence);

export default router;
