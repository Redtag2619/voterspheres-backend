import express from "express";
import {
  runConsultantImport,
  consultantImportStatus,
  consultantRankings,
  battlegroundConsultantRankings,
  consultantOverlaps,
  oppositionExposure,
  candidateConsultantRelationships,
} from "../controllers/consultantImport.controller.js";

const router = express.Router();

router.get("/status", consultantImportStatus);
router.post("/run", runConsultantImport);
router.get("/rankings", consultantRankings);
router.get("/battleground-rankings", battlegroundConsultantRankings);
router.get("/overlaps", consultantOverlaps);
router.get("/opposition-exposure", oppositionExposure);
router.get("/candidate/:candidateId", candidateConsultantRelationships);

export default router;
