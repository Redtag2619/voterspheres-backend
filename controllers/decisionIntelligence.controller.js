import {
  getDecisionIntelligence,
  seedDecisionIntelligence,
  getDecisionIntelligenceHealth,
} from "../services/decisionIntelligence.service.js";

/**
 * ============================================================================
 * Executive Decision Intelligence Controller
 * Build 2.0 — Live Authoritative Synthesis
 * ============================================================================
 *
 * Responsibilities:
 * - Preserve authenticated user / firm context.
 * - Pass selected workspace and requested scope to the synthesis service.
 * - Never silently default to workspace 1.
 * - Never manufacture fallback intelligence after an error.
 * - Return meaningful HTTP status codes.
 * - Preserve authoritative empty arrays / zero values from the service.
 * ============================================================================
 */

function clean(value = "") {
  return String(value ?? "").trim();
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

function userFromRequest(req) {
  return {
    ...(req.user || {}),
    ...(req.auth || {}),
  };
}

function workspaceIdFrom(req) {
  return optionalNumber(
    req.query?.workspace_id ??
      req.body?.workspace_id ??
      req.user?.workspace_id ??
      req.auth?.workspace_id ??
      null
  );
}

function scopeFromRequest(req) {
  return {
    workspaceId: workspaceIdFrom(req),

    state: clean(
      req.query?.state ??
        req.body?.state ??
        ""
    ),

    office: clean(
      req.query?.office ??
        req.body?.office ??
        ""
    ),

    risk: clean(
      req.query?.risk ??
        req.body?.risk ??
        ""
    ),
  };
}

function statusFromError(error) {
  const explicit = Number(
    error?.statusCode ||
      error?.status ||
      0
  );

  if (explicit >= 400 && explicit <= 599) {
    return explicit;
  }

  return 500;
}

function publicErrorMessage(error, fallback) {
  if (
    Number(error?.statusCode) >= 400 &&
    Number(error?.statusCode) < 500 &&
    clean(error?.message)
  ) {
    return clean(error.message);
  }

  return fallback;
}

/**
 * GET /api/decision-intelligence
 *
 * Synthesizes live Decision Intelligence from authoritative
 * VoterSpheres intelligence and operational sources.
 */
export async function getExecutiveDecisionIntelligence(
  req,
  res
) {
  const workspaceId = workspaceIdFrom(req);

  try {
    const data =
      await getDecisionIntelligence({
        user: userFromRequest(req),
        ...scopeFromRequest(req),
      });

    return res.status(200).json(data);
  } catch (error) {
    console.error(
      "[Decision Intelligence] GET failed:",
      error
    );

    const statusCode =
      statusFromError(error);

    return res.status(statusCode).json({
      ok: false,

      build:
        "2.0.0-live-synthesis",

      mode:
        "unavailable",

      source:
        "authoritative-synthesis-error",

      workspace_id:
        workspaceId,

      error:
        publicErrorMessage(
          error,
          "Executive Decision Intelligence is temporarily unavailable."
        ),

      detail:
        process.env.NODE_ENV ===
        "development"
          ? clean(
              error?.detail ||
                error?.message
            )
          : undefined,

      summary: {
        openDecisions: 0,
        highPriority: 0,
        avgConfidence: 0,
        avgRisk: 0,
        liveSignals: 0,
        totalDecisions: 0,
        criticalDecisions: 0,
        materialSignals: 0,
      },

      decisions: [],
      signals: [],

      generated_at:
        new Date().toISOString(),
    });
  }
}

/**
 * POST /api/decision-intelligence/seed
 *
 * Production seeding is intentionally disabled by the service.
 * This endpoint remains temporarily for backward compatibility
 * with existing frontend/backend routes.
 */
export async function seedExecutiveDecisionIntelligence(
  req,
  res
) {
  const workspaceId = workspaceIdFrom(req);

  try {
    const result =
      await seedDecisionIntelligence(
        workspaceId
      );

    return res.status(410).json({
      ...result,

      workspace_id:
        result?.workspace_id ??
        workspaceId,

      generated_at:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "[Decision Intelligence] SEED failed:",
      error
    );

    return res.status(
      statusFromError(error)
    ).json({
      ok: false,

      seeded: false,

      workspace_id:
        workspaceId,

      mode:
        "disabled",

      error:
        "Executive Decision Intelligence seeding is disabled.",

      detail:
        process.env.NODE_ENV ===
        "development"
          ? clean(error?.message)
          : undefined,

      generated_at:
        new Date().toISOString(),
    });
  }
}

/**
 * GET /api/decision-intelligence/health
 */
export async function getExecutiveDecisionIntelligenceHealth(
  req,
  res
) {
  try {
    const data =
      await getDecisionIntelligenceHealth();

    return res.status(200).json({
      service:
        "executive-decision-intelligence",

      ...data,
    });
  } catch (error) {
    console.error(
      "[Decision Intelligence] HEALTH failed:",
      error
    );

    return res.status(503).json({
      ok: false,

      service:
        "executive-decision-intelligence",

      build:
        "2.0.0-live-synthesis",

      mode:
        "unavailable",

      error:
        "Executive Decision Intelligence health check failed.",

      detail:
        process.env.NODE_ENV ===
        "development"
          ? clean(error?.message)
          : undefined,

      timestamp:
        new Date().toISOString(),
    });
  }
}
