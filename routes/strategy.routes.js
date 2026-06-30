import express from "express";

import {
  strategyDetail,
  strategyHealth,
  strategyQueueAction,
  strategyRecalculate,
  strategyRecommendations,
  strategySummary,
} from "../controllers/strategy.controller.js";

const router = express.Router();

router.get("/health", strategyHealth);
router.get("/summary", strategySummary);
router.get("/recommendations", strategyRecommendations);
router.get("/:key", strategyDetail);

router.post("/recalculate", strategyRecalculate);
router.post("/:key/queue-action", strategyQueueAction);

export default router;
