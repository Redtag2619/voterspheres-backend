import express from "express";
import {
  getExecutiveDecisionIntelligence,
  seedExecutiveDecisionIntelligence,
} from "../controllers/decisionIntelligence.controller.js";

const router = express.Router();

router.get("/", getExecutiveDecisionIntelligence);
router.post("/seed", seedExecutiveDecisionIntelligence);

export default router;