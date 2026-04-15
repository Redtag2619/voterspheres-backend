import express from "express"; 
import {
  getCandidates,
  getCandidateById,
  getCandidateStates,
  getCandidateOffices,
  getCandidateParties,
  refreshCandidateProfile,
  refreshAllCandidateProfiles
} from "../controllers/candidates.controller.js";

const router = express.Router();

router.get("/", getCandidates);
router.get("/states", getCandidateStates);
router.get("/offices", getCandidateOffices);
router.get("/parties", getCandidateParties);

// 🔥 critical routes
router.post("/refresh-profiles", refreshAllCandidateProfiles);
router.post("/:id/refresh-profile", refreshCandidateProfile);
router.get("/:id", getCandidateById);

export default router;
