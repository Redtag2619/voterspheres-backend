import express from "express";

import {
  enrichCandidateProfile,
  enrichAllCandidateProfiles,
  getCandidateContactCoverage,
} from "../services/candidateProfiles.service.js";

const router = express.Router();

router.post("/:id/enrich-profile", async (req, res) => {
  try {
    const candidateId = Number(req.params.id);

    if (!Number.isFinite(candidateId)) {
      return res.status(400).json({
        error: "Invalid candidate id",
      });
    }

    const result = await enrichCandidateProfile(candidateId);

    if (!result) {
      return res.status(404).json({
        error: "Candidate not found",
      });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "Candidate enrich profile error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Failed to enrich candidate profile",
    });
  }
});

router.post("/refresh-profiles", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.body?.limit || 100), 1),
      500
    );

    const result =
      await enrichAllCandidateProfiles(limit);

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "Candidate refresh profiles error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Failed to refresh candidate profiles",
    });
  }
});

router.get("/contact-coverage", async (req, res) => {
  try {
    const coverage =
      await getCandidateContactCoverage();

    return res.json({
      ok: true,
      coverage,
    });
  } catch (error) {
    console.error(
      "Candidate contact coverage error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Failed to load candidate contact coverage",
    });
  }
});

export default router;
