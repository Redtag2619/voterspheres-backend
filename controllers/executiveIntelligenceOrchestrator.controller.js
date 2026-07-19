import {
  getExecutiveIntelligenceOrchestratorConfig,
  planExecutiveIntelligence,
  runExecutiveIntelligenceBrief,
} from "../services/executiveIntelligenceOrchestrator.service.js";

export async function getExecutiveIntelligenceConfigController(req, res) {
  res.json(getExecutiveIntelligenceOrchestratorConfig());
}

export async function planExecutiveIntelligenceController(req, res) {
  try {
    const result = await planExecutiveIntelligence({
      ...(req.body || {}),
      workspace_id: req.body?.workspace_id || req.user?.workspace_id || 1,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("[Executive Intelligence] PLAN failed:", error);
    res.status(Number(error?.status || 500)).json({
      ok: false,
      error: error?.message || "Executive intelligence planning failed.",
    });
  }
}

export async function runExecutiveIntelligenceBriefController(req, res) {
  try {
    const result = await runExecutiveIntelligenceBrief({
      ...(req.body || {}),
      workspace_id: req.body?.workspace_id || req.user?.workspace_id || 1,
    });
    res.json(result);
  } catch (error) {
    console.error("[Executive Intelligence] BRIEF failed:", error);
    res.status(Number(error?.status || 500)).json({
      ok: false,
      service: "executive-intelligence-orchestrator",
      error: error?.message || "Executive intelligence briefing failed.",
      generated_at: new Date().toISOString(),
    });
  }
}
