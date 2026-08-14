import express from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import {

  createExecutiveVoiceSession,

  createExecutiveVoiceSpeech,

  getExecutiveVoiceConfiguration,

} from "../services/executiveVoice.service.js";

 

const router = express.Router();

const sessionRateLimit = new Map();

 

const RATE_LIMIT_WINDOW_MS = 60_000;

const MAX_SESSIONS_PER_WINDOW = 10;

const MAX_SPEECH_REQUESTS_PER_WINDOW = Number(

  process.env.EXECUTIVE_VOICE_SPEECH_RATE_LIMIT || 30

);

 

function getAuthenticatedUser(req) {

  return req.user || req.auth || {};

}

 

function getRateLimitKey(req, scope = "session") {

  const user = getAuthenticatedUser(req);

  return `${scope}:${String(

    user.id || user.user_id || user.sub || user.email || req.ip || "unknown"

  )}`;

}

 

function createRateLimitMiddleware({ scope, maximum, message }) {

  return function enforceRateLimit(req, res, next) {

    const key = getRateLimitKey(req, scope);

    const now = Date.now();

    const existing = sessionRateLimit.get(key);

 

    if (!existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {

      sessionRateLimit.set(key, { windowStartedAt: now, count: 1 });

      return next();

    }

 

    if (existing.count >= maximum) {

      const retryAfterSeconds = Math.max(

        1,

        Math.ceil(

          (RATE_LIMIT_WINDOW_MS - (now - existing.windowStartedAt)) / 1000

        )

      );

 

      res.setHeader("Retry-After", String(retryAfterSeconds));

      return res.status(429).json({

        ok: false,

        error: message,

        retry_after_seconds: retryAfterSeconds,

      });

    }

 

    existing.count += 1;

    sessionRateLimit.set(key, existing);

    return next();

  };

}

 

const enforceSessionRateLimit = createRateLimitMiddleware({

  scope: "session",

  maximum: MAX_SESSIONS_PER_WINDOW,

  message: "Too many realtime voice sessions were requested.",

});

 

const enforceSpeechRateLimit = createRateLimitMiddleware({

  scope: "speech",

  maximum: MAX_SPEECH_REQUESTS_PER_WINDOW,

  message: "Too many Executive Voice playback requests were submitted.",

});

 

function cleanExpiredRateLimits() {

  const now = Date.now();

  for (const [key, value] of sessionRateLimit.entries()) {

    if (now - value.windowStartedAt > RATE_LIMIT_WINDOW_MS * 2) {

      sessionRateLimit.delete(key);

    }

  }

}

 

const cleanupTimer = setInterval(cleanExpiredRateLimits, RATE_LIMIT_WINDOW_MS);

cleanupTimer.unref?.();

 

router.get("/config", requireAuth, async (_req, res) => {

  try {

    return res.json({ ok: true, ...getExecutiveVoiceConfiguration() });

  } catch (error) {

    console.error("[executive-voice] config failed", error);

    return res.status(500).json({

      ok: false,

      error: "Failed to load Executive Voice configuration.",

      detail: process.env.NODE_ENV === "development" ? error.message : undefined,

    });

  }

});

 

router.post(

  "/session",

  requireAuth,

  enforceSessionRateLimit,

  async (req, res) => {

    try {

      const result = await createExecutiveVoiceSession({

        user: getAuthenticatedUser(req),

        payload: req.body || {},

      });

 

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");

      res.setHeader("Pragma", "no-cache");

      res.setHeader("Expires", "0");

      return res.status(201).json({ ok: true, ...result });

    } catch (error) {

      console.error("[executive-voice] session creation failed", {

        message: error.message,

        status: error.status,

        user_id: req.user?.id || req.auth?.id || req.user?.user_id || null,

      });

 

      const status =

        Number.isInteger(error.status) && error.status >= 400 && error.status <= 599

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

        detail: process.env.NODE_ENV === "development" ? error.message : undefined,

      });

    }

  }

);

 

router.post(

  "/speak",

  requireAuth,

  enforceSpeechRateLimit,

  express.json({ limit: "32kb" }),

  async (req, res) => {

    try {

      const result = await createExecutiveVoiceSpeech({

        user: getAuthenticatedUser(req),

        payload: req.body || {},

      });

 

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");

      res.setHeader("Pragma", "no-cache");

      res.setHeader("Expires", "0");

      res.setHeader("Content-Type", result.content_type || "audio/mpeg");

      res.setHeader("Content-Length", String(result.audio.length));

      res.setHeader("X-Executive-Voice-Model", result.model);

      res.setHeader("X-Executive-Voice", result.voice);

      return res.status(200).send(result.audio);

    } catch (error) {

      console.error("[executive-voice] speech generation failed", {

        message: error.message,

        status: error.status,

        user_id: req.user?.id || req.auth?.id || req.user?.user_id || null,

      });

 

      const status =

        Number.isInteger(error.status) && error.status >= 400 && error.status <= 599

          ? error.status

          : 500;

 

      return res.status(status).json({

        ok: false,

        error:

          status === 503

            ? "Executive Voice playback is not configured."

            : status >= 500

              ? "Failed to create Executive Voice playback."

              : error.message,

        detail: process.env.NODE_ENV === "development" ? error.message : undefined,

      });

    }

  }

);

 

export default router;
