import {
  getCommitteeIntel,
  getCommitteeProfile,
} from "../services/committeeIntel.service.js";

export async function committeeIntelController(req, res) {
  try {
    const result = await getCommitteeIntel(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Committee intel error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to load committee intelligence",
    });
  }
}

export async function committeeProfileController(req, res) {
  try {
    const result = await getCommitteeProfile(req.params.id, req.query || {});

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Committee not found",
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Committee profile error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to load committee profile",
    });
  }
}
