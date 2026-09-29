import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  getExecutivePollingDashboardController,
  getExecutivePollingHealthController,
  getExecutivePollingScopesController,
  listExecutivePollingRecordsController,
} from "../controllers/executivePollingIntelligence.controller.js";

const router = Router();

router.get(
  "/health",
  requireAuth,
  getExecutivePollingHealthController
);

router.get(
  "/scopes",
  requireAuth,
  getExecutivePollingScopesController
);

router.get(
  "/dashboard",
  requireAuth,
  getExecutivePollingDashboardController
);

router.get(
  "/records",
  requireAuth,
  listExecutivePollingRecordsController
);

export default router;
