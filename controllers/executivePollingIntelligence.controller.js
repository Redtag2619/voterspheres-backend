import {
  getExecutivePollingDashboard,
  getExecutivePollingHealth,
  getExecutivePollingScopeOptions,
  listExecutivePollingRecords,
} from "../services/executivePollingIntelligence.service.js";

const PLATFORM_ROLES = new Set([
  "platform_admin",
  "super_admin",
  "platform_operator",
]);

function canViewUnresolvedPolling(req) {
  return PLATFORM_ROLES.has(String(req.user?.role || "").trim().toLowerCase());
}

export async function getExecutivePollingDashboardController(
  req,
  res,
  next
) {
  try {
    res.json(
      await getExecutivePollingDashboard({
        query: req.query || {},
        includeUnresolved: canViewUnresolvedPolling(req),
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function listExecutivePollingRecordsController(
  req,
  res,
  next
) {
  try {
    res.json(
      await listExecutivePollingRecords({
        query: req.query || {},
        includeUnresolved: canViewUnresolvedPolling(req),
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function getExecutivePollingScopesController(req, res, next) {
  try {
    res.json({
      ok: true,
      ...(await getExecutivePollingScopeOptions({
        includeUnresolved: canViewUnresolvedPolling(req),
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function getExecutivePollingHealthController(
  req,
  res,
  next
) {
  try {
    res.json(await getExecutivePollingHealth({
      includeUnresolved: canViewUnresolvedPolling(req),
    }));
  } catch (error) {
    next(error);
  }
}
