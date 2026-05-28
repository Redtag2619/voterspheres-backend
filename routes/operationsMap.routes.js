import express from "express";

import {
  getOperationsMapController,
} from "../controllers/operationsMap.controller.js";

const router = express.Router();

router.get("/", getOperationsMapController);

export default router;
