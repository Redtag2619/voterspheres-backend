import express from "express"; 
import {
  getCandidates,
  getCandidateById,
  getCandidateStates,
  getCandidateOffices,
  getCandidateParties
} from "../controllers/candidates.controller.js";

const router = express.Router();

router.get("/", getCandidates);
router.get("/states", getCandidateStates);
router.get("/offices", getCandidateOffices);
router.get("/parties", getCandidateParties);
router.get("/:id", getCandidateById);

export default router;
