import express from "express";
import {
  getExecutiveDecisionIntelligence,
  seedExecutiveDecisionIntelligence,
} from "../controllers/decisionIntelligence.controller.js";
import { requireAuth, requireEnterprise } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireEnterprise, getExecutiveDecisionIntelligence);
router.post("/seed", requireAuth, requireEnterprise, seedExecutiveDecisionIntelligence);

export default router;
