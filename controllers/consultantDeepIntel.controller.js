import { getConsultantDeepProfile } from "../services/consultantDeepIntel.service.js";

export async function consultantDeepProfileController(req, res) {
  try {
    const consultantId = Number(req.params.id);

    if (!Number.isFinite(consultantId) || consultantId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid consultant id",
      });
    }

    const result = await getConsultantDeepProfile(consultantId, req.query || {});

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Consultant not found",
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Consultant deep profile error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to load consultant deep intelligence",
    });
  }
}
