import express from "express";
import {
  listCandidates,
  getCandidateProfile,
  patchCandidateContact,
} from "../controllers/candidates.controller.js";

const router = express.Router();

router.get("/", listCandidates);
router.get("/:slug", getCandidateProfile);
router.patch("/:id/contact", patchCandidateContact);

export default router;
