import express from "express";

import {
  getExecutiveAlerts
} from "../controllers/executiveAlertEngine.controller.js";

const router = express.Router();

/**
 * GET /api/executive-alerts
 */
router.get("/", getExecutiveAlerts);

export default router;
