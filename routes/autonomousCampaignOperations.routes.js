import express from "express";
import {
  getAutonomousCampaignOperationsController,
  seedAutonomousCampaignOperationsController,
  generateAutonomousOperationPlanController,
  getAutonomousCampaignOperationsHealthController,
} from "../controllers/autonomousCampaignOperations.controller.js";

const router = express.Router();

router.get("/health", getAutonomousCampaignOperationsHealthController);
router.get("/", getAutonomousCampaignOperationsController);
router.post("/seed", seedAutonomousCampaignOperationsController);
router.post("/generate", generateAutonomousOperationPlanController);

export default router;
