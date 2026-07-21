import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getExecutiveIntelligenceConfigController,
  planExecutiveIntelligenceController,
  runExecutiveIntelligenceBriefController,
} from "../controllers/executiveIntelligence.controller.js";

const router = express.Router();
router.get("/config", requireAuth, getExecutiveIntelligenceConfigController);
router.post("/plan", requireAuth, planExecutiveIntelligenceController);
router.post("/brief", requireAuth, runExecutiveIntelligenceBriefController);
export default router;
