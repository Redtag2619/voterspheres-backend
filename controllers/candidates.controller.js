import {
  getCandidates,
  getCandidateBySlug,
  updateCandidateContact,
} from "../services/candidates.service.js";

export async function listCandidates(req, res) {
  try {
    const filters = {
      state: req.query.state || "",
      office: req.query.office || "",
      party: req.query.party || "",
      election_year: req.query.election_year || "",
      search: req.query.search || "",
    };

    const candidates = await getCandidates(filters);

    return res.status(200).json({
      success: true,
      count: candidates.length,
      candidates,
    });
  } catch (error) {
    console.error("listCandidates error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch candidates.",
    });
  }
}

export async function getCandidateProfile(req, res) {
  try {
    const { slug } = req.params;
    const candidate = await getCandidateBySlug(slug);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: "Candidate not found.",
      });
    }

    return res.status(200).json({
      success: true,
      candidate,
    });
  } catch (error) {
    console.error("getCandidateProfile error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch candidate profile.",
    });
  }
}

export async function patchCandidateContact(req, res) {
  try {
    const { id } = req.params;

    const updated = await updateCandidateContact(id, req.body || {});

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Candidate not found.",
      });
    }

    return res.status(200).json({
      success: true,
      candidate: updated,
      message: "Candidate contact information updated successfully.",
    });
  } catch (error) {
    console.error("patchCandidateContact error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update candidate contact information.",
    });
  }
}
