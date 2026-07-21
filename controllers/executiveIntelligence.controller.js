import {
  createExecutiveIntelligencePlan,
  getExecutiveOrchestratorConfiguration,
  runExecutiveIntelligenceOrchestrator,
} from "../services/executiveIntelligenceOrchestrator.service.js";

function payloadFor(req) {
  return {
    ...(req.body || {}),
    workspace_id: req.body?.workspace_id || req.body?.workspaceId || req.user?.workspace_id || req.user?.workspaceId || 1,
  };
}

function failure(res, error, fallback) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    build: "4.1.0-part1",
    service: "executive-intelligence-orchestrator",
    error: error?.message || fallback,
    generated_at: new Date().toISOString(),
  });
}

export async function getExecutiveIntelligenceConfigController(_req, res) {
  try { return res.status(200).json(getExecutiveOrchestratorConfiguration()); }
  catch (error) { console.error("[Executive Intelligence] CONFIG failed:", error); return failure(res, error, "Executive intelligence configuration failed."); }
}

export async function planExecutiveIntelligenceController(req, res) {
  try { return res.status(200).json(createExecutiveIntelligencePlan({ payload: payloadFor(req) })); }
  catch (error) { console.error("[Executive Intelligence] PLAN failed:", error); return failure(res, error, "Executive intelligence planning failed."); }
}

export async function runExecutiveIntelligenceBriefController(req, res) {
  try {
    const result = await runExecutiveIntelligenceOrchestrator({ user: req.user || req.auth || {}, payload: payloadFor(req) });
    return res.status(result.ok ? 200 : 206).json(result);
  } catch (error) {
    console.error("[Executive Intelligence] BRIEF failed:", error);
    return failure(res, error, "Executive intelligence briefing failed.");
  }
}
