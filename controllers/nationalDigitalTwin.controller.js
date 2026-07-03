import {
  getNationalDigitalTwin,
  seedNationalDigitalTwin,
  getNationalDigitalTwinHealth,
} from "../services/nationalDigitalTwin.service.js";

function workspaceIdFrom(req) {
  return Number(req.query?.workspace_id || req.body?.workspace_id || req.user?.workspace_id || 1);
}

export async function getNationalPoliticalDigitalTwin(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const data = await getNationalDigitalTwin(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...data,
    });
  } catch (error) {
    console.error("[National Digital Twin] GET failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "National Political Digital Twin fallback returned after backend error.",
      summary: {
        nationalReadinessPercentage: 0,
        averageWinProbabilityPercentage: 0,
        nationalRiskPercentage: 0,
        liveSignalCount: 0,
        highAlertStateCount: 0,
        activeRecommendationCount: 0,
      },
      states: [],
      signals: [],
      timeline: [],
      recommendations: [],
    });
  }
}

export async function seedNationalPoliticalDigitalTwin(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await seedNationalDigitalTwin(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[National Digital Twin] SEED failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Seed failed, but route remained stable.",
    });
  }
}

export async function getNationalPoliticalDigitalTwinHealth(req, res) {
  try {
    const data = await getNationalDigitalTwinHealth();
    res.json(data);
  } catch (error) {
    console.error("[National Digital Twin] HEALTH failed:", error);

    res.status(200).json({
      ok: false,
      service: "national-political-digital-twin",
      error: "Health check fallback returned after backend error.",
      timestamp: new Date().toISOString(),
    });
  }
}
