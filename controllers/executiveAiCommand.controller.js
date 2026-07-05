import {
  getExecutiveAiCommand,
  seedExecutiveAiCommand,
  generateExecutiveAiMission,
  getExecutiveAiCommandHealth,
} from "../services/executiveAiCommand.service.js";

function workspaceIdFrom(req) {
  return Number(req.query?.workspace_id || req.body?.workspace_id || req.user?.workspace_id || 1);
}

export async function getExecutiveAiCommandController(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const data = await getExecutiveAiCommand(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...data,
    });
  } catch (error) {
    console.error("[Executive AI Command] GET failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Executive AI Command fallback returned after backend error.",
      summary: {
        activeCommandBriefs: 0,
        activeExecutiveMissions: 0,
        queuedApprovalActions: 0,
        nationalReadinessPercentage: 0,
        aiConfidencePercentage: 0,
        executionRiskPercentage: 0,
      },
      brief: null,
      missions: [],
      timeline: [],
    });
  }
}

export async function seedExecutiveAiCommandController(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await seedExecutiveAiCommand(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Executive AI Command] SEED failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Seed failed, but route remained stable.",
    });
  }
}

export async function generateExecutiveAiMissionController(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await generateExecutiveAiMission(workspaceId, req.body || {});

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Executive AI Command] GENERATE failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Mission generation failed, but route remained stable.",
    });
  }
}

export async function getExecutiveAiCommandHealthController(req, res) {
  try {
    const data = await getExecutiveAiCommandHealth();
    res.json(data);
  } catch (error) {
    console.error("[Executive AI Command] HEALTH failed:", error);

    res.status(200).json({
      ok: false,
      service: "executive-ai-command-platform",
      error: "Health check fallback returned after backend error.",
      timestamp: new Date().toISOString(),
    });
  }
}
