import express from "express";

import {
  coalitionActions,
  coalitionDetail,
  coalitionHealth,
  coalitionRankings,
  coalitionRecalculate,
  coalitionSummary,
} from "../controllers/coalition.controller.js";

const router = express.Router();

router.get("/health", coalitionHealth);
router.get("/summary", coalitionSummary);
router.get("/rankings", coalitionRankings);
router.get("/actions", coalitionActions);
router.get("/:key", coalitionDetail);

router.post("/recalculate", coalitionRecalculate);

export default router;
