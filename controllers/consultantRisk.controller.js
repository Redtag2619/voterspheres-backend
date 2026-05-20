import {
  scoreConsultantRisk,
  getConsultantRiskDashboard,
  getConsultantProfile,
} from "../services/consultantRisk.service.js";

export async function scoreConsultantRiskController(req, res) {
  try {
    const result = await scoreConsultantRisk({
      ...(req.query || {}),
      ...(req.body || {}),
    });

    return res.json(result);
  } catch (error) {
    console.error("Consultant risk scoring error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to score consultant risk",
    });
  }
}

export async function consultantRiskDashboardController(req, res) {
  try {
    const result = await getConsultantRiskDashboard(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Consultant risk dashboard error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load consultant risk dashboard",
    });
  }
}

export async function consultantProfileController(req, res) {
  try {
    const consultantId = Number(req.params.id);

    if (!Number.isFinite(consultantId) || consultantId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid consultant id",
      });
    }

    const result = await getConsultantProfile(consultantId, req.query || {});

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Consultant not found",
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Consultant profile error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load consultant profile",
    });
  }
}
