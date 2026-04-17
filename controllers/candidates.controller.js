import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateStates,
  fetchCandidateOffices,
  fetchCandidateParties
} from "../services/candidates.service.js";

import {
  enrichCandidateProfile,
  enrichAllCandidateProfiles,
  updateCandidateProfileLocks,
  updateCandidateProfileManual,
  updateCandidateVerification
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
    const limit = Math.max(1, Math.min(Number(req.body?.limit || 100), 1000));
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

export async function saveCandidateProfileLocks(req, res) {
  try {
    const data = await updateCandidateProfileLocks(req.params.id, req.body || {});

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
    console.error("saveCandidateProfileLocks error:", error);
    return res.status(500).json({
      error: "Failed to save candidate profile locks"
    });
  }
}

export async function saveCandidateProfileEdits(req, res) {
  try {
    const data = await updateCandidateProfileManual(req.params.id, req.body || {}, {
      lock_edited_fields: Boolean(req.body?.lock_edited_fields)
    });

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
    console.error("saveCandidateProfileEdits error:", error);
    return res.status(500).json({
      error: "Failed to save candidate profile edits"
    });
  }
}

export async function saveCandidateVerification(req, res) {
  try {
    const data = await updateCandidateVerification(req.params.id, req.body || {});

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
    console.error("saveCandidateVerification error:", error);
    return res.status(500).json({
      error: "Failed to save candidate verification"
    });
  }
}
