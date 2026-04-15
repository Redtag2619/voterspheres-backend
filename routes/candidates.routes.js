import express from "express"; 
import {
  getCandidateById,
  getCandidateCounties,
  getCandidateOffices,
  getCandidateParties,
  getCandidates,
  getCandidateStates
} from "../controllers/candidates.controller.js";

const router = express.Router();

router.get("/", getCandidates);
router.get("/states", getCandidateStates);
router.get("/offices", getCandidateOffices);
router.get("/parties", getCandidateParties);
router.get("/counties", getCandidateCounties);
router.get("/:id", getCandidateById);

export default router;
