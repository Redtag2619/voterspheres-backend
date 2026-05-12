import express from "express";
import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateContacts, 
  fetchCandidateStates,
  fetchCandidateOffices,
  fetchCandidateParties,
  getCandidateContactCoverage,
} from "../services/candidates.service.js";

import {
  enrichCandidateProfile,
  enrichAllCandidateProfiles,
  updateCandidateProfileManual,
  updateCandidateProfileLocks,
  updateCandidateVerification,
} from "../services/candidateProfiles.service.js";

import {
  getCandidateIntelligenceSummary,
  dispatchCandidateIntelligenceAlerts,
} from "../services/candidateIntelligence.service.js";

const router = express.Router();

function numericId(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
}

router.get("/", async (req, res) => {
  try {
    const result = await fetchCandidates(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Candidate list error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidates",
    });
  }
});

router.get("/states", async (_req, res) => {
  try {
    const states = await fetchCandidateStates();
    return res.json({
      ok: true,
      states,
      results: states,
    });
  } catch (error) {
    console.error("Candidate states error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate states",
    });
  }
});

router.get("/offices", async (_req, res) => {
  try {
    const offices = await fetchCandidateOffices();
    return res.json({
      ok: true,
      offices,
      results: offices,
    });
  } catch (error) {
    console.error("Candidate offices error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate offices",
    });
  }
});

router.get("/parties", async (_req, res) => {
  try {
    const parties = await fetchCandidateParties();
    return res.json({
      ok: true,
      parties,
      results: parties,
    });
  } catch (error) {
    console.error("Candidate parties error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate parties",
    });
  }
});

router.get("/contact-coverage", async (req, res) => {
  try {
    const coverage = await getCandidateContactCoverage(req.query || {});
    return res.json({
      ok: true,
      coverage,
    });
  } catch (error) {
    console.error("Candidate contact coverage error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate contact coverage",
    });
  }
});

router.get("/intelligence/scoring", async (req, res) => {
  try {
    const result = await getCandidateIntelligenceSummary(req.query || {});
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate intelligence scoring error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate intelligence scoring",
    });
  }
});

router.post("/intelligence/dispatch-alerts", async (req, res) => {
  try {
    const result = await dispatchCandidateIntelligenceAlerts(req.body || {});
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate intelligence dispatch error:", error);
    return res.status(500).json({
      error: error.message || "Failed to dispatch candidate intelligence alerts",
    });
  }
});

router.post("/refresh-profiles", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit || 100), 1), 500);

    const result = await enrichAllCandidateProfiles(limit, {
      offset: req.body?.offset || 0,
      state: req.body?.state || null,
      onlyMissing: req.body?.only_missing !== false,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate profile batch refresh error:", error);
    return res.status(500).json({
      error: error.message || "Failed to refresh candidate profiles",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const result = await fetchCandidateById(id);

    if (!result) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate detail error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate",
    });
  }
});

router.get("/:id/contacts", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const contacts = await fetchCandidateContacts(id);

    if (!contacts) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      contacts,
      result: contacts,
    });
  } catch (error) {
    console.error("Candidate contacts error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load candidate contacts",
    });
  }
});

router.post("/:id/refresh-profile", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const result = await enrichCandidateProfile(id);

    if (!result) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate profile refresh error:", error);
    return res.status(500).json({
      error: error.message || "Failed to refresh candidate profile",
    });
  }
});

router.post("/:id/enrich-profile", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const result = await enrichCandidateProfile(id);

    if (!result) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate profile enrich error:", error);
    return res.status(500).json({
      error: error.message || "Failed to enrich candidate profile",
    });
  }
});

router.post("/:id/manual-profile", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const result = await updateCandidateProfileManual(id, req.body || {}, {
      lock_edited_fields: Boolean(req.body?.lock_edited_fields),
    });

    if (!result) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate manual profile error:", error);
    return res.status(500).json({
      error: error.message || "Failed to update candidate profile",
    });
  }
});

router.patch("/:id/profile-locks", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const profile = await updateCandidateProfileLocks(id, req.body || {});

    if (!profile) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      profile,
    });
  } catch (error) {
    console.error("Candidate profile lock error:", error);
    return res.status(500).json({
      error: error.message || "Failed to update candidate profile locks",
    });
  }
});

router.patch("/:id/verification", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const result = await updateCandidateVerification(id, req.body || {});

    if (!result) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Candidate verification error:", error);
    return res.status(500).json({
      error: error.message || "Failed to update candidate verification",
    });
  }
});

export default router;
