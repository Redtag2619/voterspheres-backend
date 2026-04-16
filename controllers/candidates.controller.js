import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateStates,
  fetchCandidateOffices,
  fetchCandidateParties,
  updateCandidateProfileLocks
} from "../services/candidates.service.js";
import {
  enrichCandidateProfile,
  enrichAllCandidateProfiles
} from "../services/candidateEnrichment.service.js";

export async function getCandidates(req, res) {
  try {
    const data = await fetchCandidates(req.query);
    return res.json(data);
  } catch (error) {
    console.error("getCandidates error:", error);
    return res.status(500).json({
      error: "Failed to load candidates"
    });
  }
}

export async function getCandidateById(req, res) {
  try {
    const data = await fetchCandidateById(req.params.id);

    if (!data) {
      return res.status(404).json({
        error: "Candidate not found"
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("getCandidateById error:", error);
    return res.status(500).json({
      error: "Failed to load candidate profile"
    });
  }
}

export async function getCandidateStates(_req, res) {
  try {
    const data = await fetchCandidateStates();
    return res.json(data);
  } catch (error) {
    console.error("getCandidateStates error:", error);
    return res.status(500).json({
      error: "Failed to load candidate states"
    });
  }
}

export async function getCandidateOffices(_req, res) {
  try {
    const data = await fetchCandidateOffices();
    return res.json(data);
  } catch (error) {
    console.error("getCandidateOffices error:", error);
    return res.status(500).json({
      error: "Failed to load candidate offices"
    });
  }
}

export async function getCandidateParties(_req, res) {
  try {
    const data = await fetchCandidateParties();
    return res.json(data);
  } catch (error) {
    console.error("getCandidateParties error:", error);
    return res.status(500).json({
      error: "Failed to load candidate parties"
    });
  }
}

export async function refreshCandidateProfile(req, res) {
  try {
    const data = await enrichCandidateProfile(req.params.id);

    if (!data) {
      return res.status(404).json({
        error: "Candidate not found"
      });
    }

    return res.json({
      success: true,
      candidate: data.candidate,
      profile: data.profile
    });
  } catch (error) {
    console.error("refreshCandidateProfile error:", error);
    return res.status(500).json({
      error: "Failed to refresh candidate profile"
    });
  }
}

export async function refreshAllCandidateProfiles(req, res) {
  try {
    const limit = Math.max(1, Math.min(Number(req.body?.limit || 100), 500));
    const data = await enrichAllCandidateProfiles(limit);

    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error("refreshAllCandidateProfiles error:", error);
    return res.status(500).json({
      error: "Failed to refresh candidate profiles"
    });
  }
}

export async function patchCandidateProfileLocks(req, res) {
  try {
    const { admin_locked, locked_fields } = req.body || {};

    const data = await updateCandidateProfileLocks(req.params.id, {
      admin_locked,
      locked_fields
    });

    if (!data) {
      return res.status(404).json({
        error: "Candidate not found"
      });
    }

    return res.json({
      success: true,
      profile: data
    });
  } catch (error) {
    console.error("patchCandidateProfileLocks error:", error);
    return res.status(500).json({
      error: "Failed to update profile locks"
    });
  }
}
