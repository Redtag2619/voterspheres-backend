import express from "express";
import {
  getStateOperationsIndex,
  getStateOperationsDrilldown,
} from "../controllers/operations.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * TEMP PUBLIC DEBUG ROUTES
 * Use these locally to verify the controller works.
 */
router.get("/debug/states", getStateOperationsIndex);
router.get("/debug/state/:state", getStateOperationsDrilldown);

/**
 * PRODUCTION ROUTES
 */
router.get("/states", requireAuth, getStateOperationsIndex);
router.get("/state/:state", requireAuth, getStateOperationsDrilldown);

export default router;
