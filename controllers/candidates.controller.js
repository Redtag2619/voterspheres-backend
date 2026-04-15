import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateStates,
  fetchCandidateOffices,
  fetchCandidateParties
} from "../services/candidates.service.js";

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

export async function getCandidateStates(req, res) {
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

export async function getCandidateOffices(req, res) {
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

export async function getCandidateParties(req, res) {
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
