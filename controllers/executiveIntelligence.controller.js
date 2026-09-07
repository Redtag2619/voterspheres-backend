import {
  createExecutiveIntelligencePlan,
  getExecutiveOrchestratorConfiguration, 
  runExecutiveIntelligenceOrchestrator,
} from "../services/executiveIntelligenceOrchestrator.service.js";
import { assertOwnedWorkspace, positiveId } from "../middleware/authorization.middleware.js";

async function payloadFor(req) {
  const firmId = positiveId(req.user?.firm_id);
  if (!firmId) throw Object.assign(new Error("Firm access required"), { status: 403 });
  const rawWorkspaceId = req.body?.workspace_id || req.body?.workspaceId || req.user?.workspace_id || req.user?.workspaceId || null;
  const workspaceId = rawWorkspaceId ? positiveId(rawWorkspaceId) : null;
  if (rawWorkspaceId && !workspaceId) throw Object.assign(new Error("Invalid workspace id"), { status: 400 });
  if (workspaceId && !(await assertOwnedWorkspace(workspaceId, firmId))) {
    throw Object.assign(new Error("Workspace not found"), { status: 404 });
  }
  return {
    ...(req.body || {}),
    workspace_id: workspaceId,
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
  try { return res.status(200).json(createExecutiveIntelligencePlan({ payload: await payloadFor(req) })); }
  catch (error) { console.error("[Executive Intelligence] PLAN failed:", error); return failure(res, error, "Executive intelligence planning failed."); }
}

export async function runExecutiveIntelligenceBriefController(req, res) {
  try {
    const result = await runExecutiveIntelligenceOrchestrator({ user: req.user || req.auth || {}, payload: await payloadFor(req) });
    return res.status(result.ok ? 200 : 206).json(result);
  } catch (error) {
    console.error("[Executive Intelligence] BRIEF failed:", error);
    return failure(res, error, "Executive intelligence briefing failed.");
  }
}

