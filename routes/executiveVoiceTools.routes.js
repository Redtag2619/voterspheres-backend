import express from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  EXECUTIVE_VOICE_TOOL_DEFINITIONS,
  executeExecutiveVoiceTool,
} from "../services/executiveVoiceTools.service.js";

const router = express.Router();

const limiter = rateLimit({
  windowMs:
    60 * 1000,

  limit:
    Number(
      process.env
        .EXECUTIVE_VOICE_TOOL_RATE_LIMIT ||
        30
    ),

  standardHeaders:
    true,

  legacyHeaders:
    false,

  message: {
    ok: false,

    error:
      "Executive Voice live-data tool rate limit exceeded.",
  },
});

function userFromRequest(
  req
) {
  return {
    ...(req.user || {}),
    ...(req.auth || {}),

    firm_id:
      req.auth?.firmId ||
      req.auth?.firm_id ||
      req.user?.firm_id ||
      null,
  };
}

function parseArguments(
  value
) {
  if (!value) {
    return {};
  }

  if (
    typeof value ===
      "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  try {
    return JSON.parse(
      String(value)
    );
  } catch {
    return {};
  }
}

router.get(
  "/definitions",
  requireAuth,
  (req, res) => {
    return res.json({
      ok: true,

      tools:
        EXECUTIVE_VOICE_TOOL_DEFINITIONS,

      generated_at:
        new Date().toISOString(),
    });
  }
);

router.post(
  "/execute",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const name =
        String(
          req.body?.name ||
            ""
        ).trim();

      if (!name) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Tool name is required.",
          });
      }

      const output =
        await executeExecutiveVoiceTool({
          name,

          arguments:
            parseArguments(
              req.body
                ?.arguments
            ),

          user:
            userFromRequest(
              req
            ),
        });

      return res
        .status(200)
        .json(output);
    } catch (error) {
      console.error(
        "[executive-voice-tools] execution failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Executive Voice live-data tool execution failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

export default router;