import {
  getExecutiveOrchestratorConfiguration,
  createExecutiveIntelligencePlan,
  runExecutiveIntelligenceOrchestrator,
} from "../services/executiveIntelligenceOrchestrator.service.js";

/**
 * GET /api/executive-intelligence-orchestrator/config
 */
export async function getExecutiveIntelligenceConfigController(req, res) {
  try {
    const result = getExecutiveOrchestratorConfiguration();

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "[Executive Intelligence] CONFIG failed:",
      error
    );

    return res.status(Number(error?.status || 500)).json({
      ok: false,
      service: "executive-intelligence-orchestrator",
      error:
        error?.message ||
        "Executive intelligence configuration failed.",
      generated_at: new Date().toISOString(),
    });
  }
}

/**
 * POST /api/executive-intelligence-orchestrator/plan
 */
export async function planExecutiveIntelligenceController(req, res) {
  try {
    const payload = {
      ...(req.body || {}),
      workspace_id:
        req.body?.workspace_id ||
        req.body?.workspaceId ||
        req.user?.workspace_id ||
        req.user?.workspaceId ||
        1,
    };

    const result = createExecutiveIntelligencePlan({
      payload,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "[Executive Intelligence] PLAN failed:",
      error
    );

    return res.status(Number(error?.status || 500)).json({
      ok: false,
      service: "executive-intelligence-orchestrator",
      error:
        error?.message ||
        "Executive intelligence planning failed.",
      generated_at: new Date().toISOString(),
    });
  }
}

/**
 * POST /api/executive-intelligence-orchestrator/brief
 */
export async function runExecutiveIntelligenceBriefController(req, res) {
  try {
    const payload = {
      ...(req.body || {}),
      workspace_id:
        req.body?.workspace_id ||
        req.body?.workspaceId ||
        req.user?.workspace_id ||
        req.user?.workspaceId ||
        1,
    };

    const result =
      await runExecutiveIntelligenceOrchestrator({
        user: req.user || {},
        payload,
      });

    return res.status(result?.ok ? 200 : 207).json(result);
  } catch (error) {
    console.error(
      "[Executive Intelligence] BRIEF failed:",
      error
    );

    return res.status(Number(error?.status || 500)).json({
      ok: false,
      service: "executive-intelligence-orchestrator",
      error:
        error?.message ||
        "Executive intelligence briefing failed.",
      generated_at: new Date().toISOString(),
    });
  }
}
