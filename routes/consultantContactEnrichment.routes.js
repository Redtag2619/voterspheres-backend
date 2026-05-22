import express from "express";
import {
  consultantContactStatusController,
  consultantsNeedingContactEnrichmentController,
  enrichSingleConsultantContactController,
  enrichConsultantContactsBatchController,
  consultantContactHistoryController,
} from "../controllers/consultantContactEnrichment.controller.js";

const router = express.Router();

router.get("/status", consultantContactStatusController);
router.get("/needs-enrichment", consultantsNeedingContactEnrichmentController);
router.post("/run", enrichConsultantContactsBatchController);
router.post("/:id", enrichSingleConsultantContactController);
router.get("/:id/history", consultantContactHistoryController);

export default router;
