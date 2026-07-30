import {
  buildLiveIntelligenceReadiness,
} from "../services/liveIntelligenceReadiness.service.js";

export async function getLiveIntelligenceLayer(
  req,
  res
) {
  try {
    const payload =
      await buildLiveIntelligenceReadiness();

    return res.status(200).json(payload);
  } catch (error) {
    console.error(
      "[Live Intelligence] readiness scan failed",
      error
    );

    return res.status(500).json({
      error:
        "Failed to build live intelligence readiness.",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : error?.message ||
            "Unknown readiness error.",
    });
  }
}

