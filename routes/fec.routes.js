import express from "express";
import {
  triggerFecCandidateIngestion,
  getStoredFecCandidates,
  getStoredFundraisingSnapshots
} from "../services/fecIngestion.service.js";

const router = express.Router();

router.post("/ingest", triggerFecCandidateIngestion);
router.get("/candidates", getStoredFecCandidates);
router.get("/fundraising", getStoredFundraisingSnapshots);

export default router;
