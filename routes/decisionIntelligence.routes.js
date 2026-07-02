import express from "express";
import {
  getExecutiveDecisionIntelligence,
  seedExecutiveDecisionIntelligence,
} from "../controllers/decisionIntelligence.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireEnterprise } from "../middleware/requireEnterprise.js";

const router = express.Router();

router.get("/", requireAuth, requireEnterprise, getExecutiveDecisionIntelligence);
router.post("/seed", requireAuth, requireEnterprise, seedExecutiveDecisionIntelligence);

export default router;
