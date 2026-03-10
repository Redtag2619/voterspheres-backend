import express from "express";
import {
  getCandidates,
  getCandidateStates,
  getCandidateOffices,
  getCandidateParties,
  getCandidateCounties
} from "../services/candidates.service.js";

const router = express.Router();

router.get("/", getCandidates);
router.get("/dropdowns/states", getCandidateStates);
router.get("/dropdowns/offices", getCandidateOffices);
router.get("/dropdowns/parties", getCandidateParties);
router.get("/dropdowns/counties", getCandidateCounties);

export default router;
