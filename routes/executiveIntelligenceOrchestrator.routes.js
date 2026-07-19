import { Router } from "express";
import {
  getExecutiveIntelligenceConfigController,
  planExecutiveIntelligenceController,
  runExecutiveIntelligenceBriefController,
} from "../controllers/executiveIntelligenceOrchestrator.controller.js";

const router = Router();

router.get("/config", getExecutiveIntelligenceConfigController);
router.post("/plan", planExecutiveIntelligenceController);
router.post("/brief", runExecutiveIntelligenceBriefController);

export default router;

