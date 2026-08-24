import express from "express";
import {
  darkMoneyExposureController,
  darkMoneyExposureProfileController,
} from "../controllers/darkMoneyExposure.controller.js";
import {
  importPoliticalMoneyEvidenceController,
  politicalMoneyEvidenceProfileController,
  politicalMoneyProviderHealthController,
  rebuildPoliticalMoneyScoresController,
  syncFecPoliticalMoneyController,
} from "../controllers/politicalMoneyEvidence.controller.js";

const router = express.Router();

router.get("/", darkMoneyExposureController);
router.get("/profile/:id", darkMoneyExposureProfileController);
router.get("/providers/health", politicalMoneyProviderHealthController);
router.get("/evidence/:id", politicalMoneyEvidenceProfileController);
router.post("/sync/fec", syncFecPoliticalMoneyController);
router.post("/evidence/import", express.json({ limit: "5mb" }), importPoliticalMoneyEvidenceController);
router.post("/scores/rebuild", rebuildPoliticalMoneyScoresController);

export default router;

