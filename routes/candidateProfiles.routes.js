import express from "express";
import {
  getCandidateProfileAdminDirectory,
  getCandidateProfileByCandidateId,
  removeCandidateProfile,
  saveCandidateProfile
} from "../controllers/candidateProfiles.controller.js";

const router = express.Router();

router.get("/admin-directory", getCandidateProfileAdminDirectory);
router.get("/:candidateId", getCandidateProfileByCandidateId);
router.put("/:candidateId", saveCandidateProfile);
router.delete("/:candidateId", removeCandidateProfile);

export default router;
