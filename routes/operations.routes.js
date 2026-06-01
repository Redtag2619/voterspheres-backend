import express from "express";
import {
  getOperationsMap,
  getStateOperationsIndex,
  getStateOperationsDrilldown,
} from "../controllers/operations.controller.js";
import {
  createCountyCommandTaskController,
  updateCountyCommandTaskStatusController,
} from "../controllers/operationsCommandTasks.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/map", requireAuth, getOperationsMap);
router.get("/states", requireAuth, getStateOperationsIndex);
router.get("/state/:state", requireAuth, getStateOperationsDrilldown);

router.post("/tasks/county", requireAuth, createCountyCommandTaskController);
router.put("/tasks/county/:id/status", requireAuth, updateCountyCommandTaskStatusController);

export default router;
