import express from "express";
import {
  getStateOperationsIndex,
  getStateOperationsDrilldown,
} from "../controllers/operations.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/states", requireAuth, getStateOperationsIndex);
router.get("/state/:state", requireAuth, getStateOperationsDrilldown); 

export default router;
