import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  getExecutivePollingDashboardController,
  getExecutivePollingHealthController,
  listExecutivePollingRecordsController,
} from "../controllers/executivePollingIntelligence.controller.js";

const router = Router();

router.get(
  "/health",
  requireAuth,
  getExecutivePollingHealthController
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

