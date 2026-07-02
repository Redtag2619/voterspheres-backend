import express from "express";
import {
  getPredictiveCampaignSimulations,
  seedPredictiveCampaignSimulations,
  runPredictiveCampaignSimulation,
  getPredictiveCampaignSimulationHealth,
} from "../controllers/campaignSimulation.controller.js";

const router = express.Router();

router.get("/health", getPredictiveCampaignSimulationHealth);
router.get("/", getPredictiveCampaignSimulations);
router.post("/seed", seedPredictiveCampaignSimulations);
router.post("/run", runPredictiveCampaignSimulation);

export default router;
