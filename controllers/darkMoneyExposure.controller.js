import {
  getDarkMoneyExposure,
  getDarkMoneyExposureProfile,
} from "../services/darkMoneyExposure.service.js";

export async function darkMoneyExposureController(req, res) {
  try {
    const result = await getDarkMoneyExposure(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Dark money exposure error:", error);

    return res.status(error?.statusCode || 500).json({
      ok: false,
      error:
        error.message ||
        "Failed to load dark money exposure intelligence",
    });
  }
}

export async function darkMoneyExposureProfileController(req, res) {
  try {
    const result = await getDarkMoneyExposureProfile(
      req.params.id,
      req.query || {}
    );

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Dark money exposure profile not found",
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Dark money exposure profile error:", error);

    return res.status(error?.statusCode || 500).json({
      ok: false,
      error:
        error.message ||
        "Failed to load dark money exposure profile",
    });
  }
}
