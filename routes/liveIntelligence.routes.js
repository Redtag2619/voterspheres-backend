import { Router } from "express";

import {
  requireAuth,
} from "../middleware/auth.middleware.js";

import {
  getLiveIntelligenceLayer,
} from "../controllers/liveIntelligence.controller.js";

const router = Router();

router.get(
  "/layer",
  requireAuth,
  getLiveIntelligenceLayer
);

export default router;
