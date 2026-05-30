import express from "express";
import {
  getStateOperationsIndex,
  getStateOperationsDrilldown,
} from "../controllers/operations.controller.js";

const router = express.Router();

router.get("/states", getStateOperationsIndex);
router.get("/state/:state", getStateOperationsDrilldown);

export default router;
