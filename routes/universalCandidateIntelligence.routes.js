import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getUniversalCandidateHealthController,
  listUniversalCandidatesController,
  resolveUniversalCandidateController,
} from "../controllers/universalCandidateIntelligence.controller.js";

const router = Router();

router.get("/health", requireAuth, getUniversalCandidateHealthController);
router.get("/candidates", requireAuth, listUniversalCandidatesController);
router.post("/resolve", requireAuth, resolveUniversalCandidateController);

export default router;
