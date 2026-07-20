import express from "express";

import {
  getExecutiveIntelligenceConfigController,
  planExecutiveIntelligenceController,
  runExecutiveIntelligenceBriefController,
} from "../controllers/executiveIntelligence.controller.js";

// Replace this import only if your actual auth middleware
// has a different filename or export name.
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET
 * /api/executive-intelligence-orchestrator/config
 *
 * Kept public for basic service verification.
 * Add requireAuth here later if desired.
 */
router.get(
  "/config",
  getExecutiveIntelligenceConfigController
);

/**
 * POST
 * /api/executive-intelligence-orchestrator/plan
 */
router.post(
  "/plan",
  requireAuth,
  planExecutiveIntelligenceController
);

/**
 * POST
 * /api/executive-intelligence-orchestrator/brief
 */
router.post(
  "/brief",
  requireAuth,
  runExecutiveIntelligenceBriefController
);

export default router;
