import express from "express";
import {
  politicalGraphEntity,
  politicalGraphHealth,
  politicalGraphIndex,
  politicalGraphPath,
  politicalGraphRelationships,
  politicalGraphSearch,
  politicalGraphStats,
} from "../controllers/politicalGraph.controller.js";

const router = express.Router();

router.get("/health", politicalGraphHealth);
router.get("/", politicalGraphIndex);
router.get("/search", politicalGraphSearch);
router.get("/relationships", politicalGraphRelationships);
router.get("/path", politicalGraphPath);
router.get("/stats", politicalGraphStats);
router.get("/entity/:id", politicalGraphEntity);
router.get("/entity", politicalGraphRelationships);

export default router;
