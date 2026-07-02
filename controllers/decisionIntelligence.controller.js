import {
  getDecisionIntelligence,
  seedDecisionIntelligence,
  getDecisionIntelligenceHealth,
} from "../services/decisionIntelligence.service.js";

function workspaceIdFrom(req) {
  return Number(req.query?.workspace_id || req.body?.workspace_id || req.user?.workspace_id || 1);
}

export async function getExecutiveDecisionIntelligence(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const data = await getDecisionIntelligence(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...data,
    });
  } catch (error) {
    console.error("[Decision Intelligence] GET failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Decision intelligence fallback returned after backend error.",
      summary: {
        openDecisions: 0,
        highPriority: 0,
        avgConfidence: 0,
        avgRisk: 0,
        liveSignals: 0,
      },
      decisions: [],
      signals: [],
    });
  }
}

export async function seedExecutiveDecisionIntelligence(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await seedDecisionIntelligence(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Decision Intelligence] SEED failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Seed failed, but route remained stable.",
    });
  }
}

export async function getExecutiveDecisionIntelligenceHealth(req, res) {
  try {
    const data = await getDecisionIntelligenceHealth();
    res.json(data);
  } catch (error) {
    console.error("[Decision Intelligence] HEALTH failed:", error);

    res.status(200).json({
      ok: false,
      service: "executive-decision-intelligence",
      error: "Health check fallback returned after backend error.",
      timestamp: new Date().toISOString(),
    });
  }
}
