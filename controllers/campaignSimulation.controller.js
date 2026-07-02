import {
  getCampaignSimulations,
  seedCampaignSimulations,
  runCampaignSimulation,
  getCampaignSimulationHealth,
} from "../services/campaignSimulation.service.js";

function workspaceIdFrom(req) {
  return Number(req.query?.workspace_id || req.body?.workspace_id || req.user?.workspace_id || 1);
}

export async function getPredictiveCampaignSimulations(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const data = await getCampaignSimulations(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...data,
    });
  } catch (error) {
    console.error("[Campaign Simulation] GET failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Predictive Campaign Simulation fallback returned after backend error.",
      summary: {
        activeSimulations: 0,
        averageWinProbability: 0,
        averageTurnoutLift: 0,
        averageFundingImpact: 0,
        averageCoalitionMovement: 0,
        averageExecutionReadiness: 0,
      },
      simulations: [],
      signals: [],
    });
  }
}

export async function seedPredictiveCampaignSimulations(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await seedCampaignSimulations(workspaceId);

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Campaign Simulation] SEED failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Seed failed, but route remained stable.",
    });
  }
}

export async function runPredictiveCampaignSimulation(req, res) {
  try {
    const workspaceId = workspaceIdFrom(req);
    const result = await runCampaignSimulation(workspaceId, req.body || {});

    res.json({
      ok: true,
      workspace_id: workspaceId,
      ...result,
    });
  } catch (error) {
    console.error("[Campaign Simulation] RUN failed:", error);

    res.status(200).json({
      ok: false,
      workspace_id: workspaceIdFrom(req),
      error: "Simulation run failed, but route remained stable.",
    });
  }
}

export async function getPredictiveCampaignSimulationHealth(req, res) {
  try {
    const data = await getCampaignSimulationHealth();
    res.json(data);
  } catch (error) {
    console.error("[Campaign Simulation] HEALTH failed:", error);

    res.status(200).json({
      ok: false,
      service: "predictive-campaign-simulation",
      error: "Health check fallback returned after backend error.",
      timestamp: new Date().toISOString(),
    });
  }
}
