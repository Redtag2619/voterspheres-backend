import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  getPollingHealthController,
  getPollingJobStatusController,
  listPollingController,
  migrateLegacyPollingController,
  syncPollingController,
} from "../controllers/pollingIntelligence.controller.js";

const router = Router();

router.get("/health", requireAuth, getPollingHealthController);
router.get("/records", requireAuth, listPollingController);
router.get("/job", requireAuth, getPollingJobStatusController);
router.post("/sync", requireAuth, syncPollingController);
router.post("/migrate-legacy", requireAuth, migrateLegacyPollingController);

export default router;
