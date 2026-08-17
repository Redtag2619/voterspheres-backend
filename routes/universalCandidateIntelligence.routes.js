import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getUniversalCandidateHealthController,
  resolveUniversalCandidateController,
} from "../controllers/universalCandidateIntelligence.controller.js";

const router = Router();

router.get("/health", requireAuth, getUniversalCandidateHealthController);
router.post("/resolve", requireAuth, resolveUniversalCandidateController);

export default router;

