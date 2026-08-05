
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  getPollingHealthController,
  getPollingJobStatusController,
  listPollingController,
  syncPollingController,
} from "../controllers/pollingIntelligence.controller.js";

const router = Router();

router.get("/health", requireAuth, getPollingHealthController);
router.get("/records", requireAuth, listPollingController);
router.get("/job", requireAuth, getPollingJobStatusController);
router.post("/sync", requireAuth, syncPollingController);

export default router;

