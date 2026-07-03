import {
  getAutonomousCampaignOperations,
  seedAutonomousCampaignOperations,
  generateAutonomousOperationPlan,
  getAutonomousCampaignOperationsHealth,
} from "../services/autonomousCampaignOperations.service.js";

function workspaceIdFrom(req) {
  return Number(req.query?.workspace_id || req.body?.workspace_id || req.user?.workspace_id || 1);
}

export async function getAutonomousCampaignOperationsController(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const data = await getAutonomousCampaignOperations(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...data,
    });
  } catch (error) {
    console.error("[Autonomous Campaign Operations] GET failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Autonomous Campaign Operations fallback returned after backend error.",
      summary: {
        activeOperationPlans: 0,
        queuedAutonomousTasks: 0,
        highPriorityAlerts: 0,
        averageAutomationReadinessPercentage: 0,
        averageOperationalImpactPercentage: 0,
        averageExecutionRiskPercentage: 0,
      },
      plans: [],
      alerts: [],
      playbooks: [],
    });
  }
}

export async function seedAutonomousCampaignOperationsController(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await seedAutonomousCampaignOperations(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Autonomous Campaign Operations] SEED failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Seed failed, but route remained stable.",
    });
  }
}

export async function generateAutonomousOperationPlanController(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await generateAutonomousOperationPlan(workspaceId, req.body || {});

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Autonomous Campaign Operations] GENERATE failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Plan generation failed, but route remained stable.",
    });
  }
}

export async function getAutonomousCampaignOperationsHealthController(req, res) {
  try {
    const data = await getAutonomousCampaignOperationsHealth();
    res.json(data);
  } catch (error) {
    console.error("[Autonomous Campaign Operations] HEALTH failed:", error);

    res.status(200).json({
      ok: false,
      service: "autonomous-campaign-operations",
      error: "Health check fallback returned after backend error.",
      timestamp: new Date().toISOString(),
    });
  }
}
