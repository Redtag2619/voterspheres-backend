import {
  getDecisionIntelligence,
  seedDecisionIntelligence,
} from "../services/decisionIntelligence.service.js";

export async function getExecutiveDecisionIntelligence(req, res) {
  try {
    const workspaceId = Number(req.query.workspace_id || req.user?.workspace_id || 1);

    const data = await getDecisionIntelligence(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...data,
    });
  } catch (error) {
    console.error("[Decision Intelligence] GET failed:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to load executive decision intelligence.",
    });
  }
}

export async function seedExecutiveDecisionIntelligence(req, res) {
  try {
    const workspaceId = Number(req.query.workspace_id || req.user?.workspace_id || 1);

    const result = await seedDecisionIntelligence(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Decision Intelligence] SEED failed:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to seed executive decision intelligence.",
    });
  }
}
