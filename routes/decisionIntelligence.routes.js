import express from "express";
import {
  getExecutiveDecisionIntelligence,
  seedExecutiveDecisionIntelligence,
} from "../controllers/decisionIntelligence.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth, getExecutiveDecisionIntelligence);
router.post("/seed", requireAuth, seedExecutiveDecisionIntelligence);

export default router;
