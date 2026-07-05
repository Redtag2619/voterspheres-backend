import express from "express";
import {
  getExecutiveAiCommandController,
  seedExecutiveAiCommandController,
  generateExecutiveAiMissionController,
  getExecutiveAiCommandHealthController,
} from "../controllers/executiveAiCommand.controller.js";

const router = express.Router();

router.get("/health", getExecutiveAiCommandHealthController);
router.get("/", getExecutiveAiCommandController);
router.post("/seed", seedExecutiveAiCommandController);
router.post("/generate", generateExecutiveAiMissionController);

export default router;
