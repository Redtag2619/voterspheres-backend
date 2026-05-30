import express from "express";
import { getStateOperationsDrilldown } from "../controllers/operations.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/state/:state", requireAuth, getStateOperationsDrilldown);

export default router;
