import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createExecutiveVoiceSession,
  getExecutiveVoiceConfiguration,
} from "../services/executiveVoice.service.js";

const router = express.Router();

const sessionRateLimit = new Map();

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_SESSIONS_PER_WINDOW = 10;

function getAuthenticatedUser(req) {
  return req.user || req.auth || {};
}

function getRateLimitKey(req) {
  const user = getAuthenticatedUser(req);

  return String(
    user.id ||
      user.user_id ||
      user.sub ||
      user.email ||
      req.ip ||
      "unknown"
  );
}

function enforceSessionRateLimit(req, res, next) {
  const key = getRateLimitKey(req);
  const now = Date.now();

  const existing = sessionRateLimit.get(key);

  if (
    !existing ||
    now - existing.windowStartedAt >=
      RATE_LIMIT_WINDOW_MS
  ) {
    sessionRateLimit.set(key, {
      windowStartedAt: now,
      count: 1,
    });

    return next();
  }

  if (existing.count >= MAX_SESSIONS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (RATE_LIMIT_WINDOW_MS -
          (now - existing.windowStartedAt)) /
          1000
      )
    );

    res.setHeader(
      "Retry-After",
      String(retryAfterSeconds)
    );

    return res.status(429).json({
      ok: false,
      error:
        "Too many realtime voice sessions were requested.",
      retry_after_seconds: retryAfterSeconds,
    });
  }

  existing.count += 1;
  sessionRateLimit.set(key, existing);

  return next();
}

function cleanExpiredRateLimits() {
  const now = Date.now();

  for (const [key, value] of sessionRateLimit.entries()) {
    if (
      now - value.windowStartedAt >
      RATE_LIMIT_WINDOW_MS * 2
    ) {
      sessionRateLimit.delete(key);
    }
  }
}

const cleanupTimer = setInterval(
  cleanExpiredRateLimits,
  RATE_LIMIT_WINDOW_MS
);

cleanupTimer.unref?.();

/**
 * GET /api/executive-voice/config
 *
 * Returns public, non-secret realtime configuration.
 */
router.get(
  "/config",
  requireAuth,
  async (_req, res) => {
    try {
      return res.json({
        ok: true,
        ...getExecutiveVoiceConfiguration(),
      });
    } catch (error) {
      console.error(
        "[executive-voice] config failed",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Failed to load Executive Voice configuration.",
        detail:
          process.env.NODE_ENV === "development"
            ? error.message
            : undefined,
      });
    }
  }
);

/**
 * POST /api/executive-voice/session
 *
 * Creates a short-lived OpenAI Realtime client secret.
 *
 * Example body:
 * {
 *   "voice": "marin",
 *   "agent": "executive_chief_of_staff",
 *   "workspace_id": 1,
 *   "executive_context": {
 *     "selected_state": "GA",
 *     "geographic_scope": "Georgia",
 *     "national_readiness_percentage": 82,
 *     "execution_risk_percentage": 31,
 *     "consultation_mode": "team"
 *   }
 * }
 */
router.post(
  "/session",
  requireAuth,
  enforceSessionRateLimit,
  async (req, res) => {
    try {
      const result =
        await createExecutiveVoiceSession({
          user: getAuthenticatedUser(req),
          payload: req.body || {},
        });

      /*
       * Ephemeral secrets must not be cached by browsers,
       * CDNs, reverse proxies, or shared gateways.
       */
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, private"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      return res.status(201).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(
        "[executive-voice] session creation failed",
        {
          message: error.message,
          status: error.status,
          user_id:
            req.user?.id ||
            req.auth?.id ||
            req.user?.user_id ||
            null,
        }
      );

      const status =
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599
          ? error.status
          : 500;

      return res.status(status).json({
        ok: false,
        error:
          status === 503
            ? "Executive Voice is not configured."
            : status >= 500
              ? "Failed to create Executive Voice session."
              : error.message,

        detail:
          process.env.NODE_ENV === "development"
            ? error.message
            : undefined,
      });
    }
  }
);

export default router;