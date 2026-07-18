import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  EXECUTIVE_VOICE_TOOL_DEFINITIONS,
  executeExecutiveVoiceTool,
} from "../services/executiveVoiceTools.service.js";

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,

  limit:
    Number(
      process.env.EXECUTIVE_VOICE_TOOL_RATE_LIMIT ||
        30
    ),

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    ok: false,
    error:
      "Executive Voice live-data tool rate limit exceeded.",
  },
});

function userFromRequest(req) {
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

function parseArguments(value) {
  if (!value) {
    return {};
  }

  if (
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  try {
    return JSON.parse(
      String(value)
    );
  } catch (error) {
    console.warn(
      "[executive-voice-tools] Unable to parse tool arguments:",
      {
        value,
        error:
          error?.message ||
          "Unknown argument parsing error.",
      }
    );

    return {};
  }
}

function createErrorId() {
  if (
    typeof crypto.randomUUID ===
    "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("-");
}

function safeErrorDetails(error) {
  return {
    name:
      error?.name ||
      "Error",

    message:
      error?.message ||
      "Unknown Executive Voice tool error.",

    code:
      error?.code ||
      null,

    detail:
      error?.detail ||
      null,

    hint:
      error?.hint ||
      null,

    table:
      error?.table ||
      null,

    column:
      error?.column ||
      null,

    constraint:
      error?.constraint ||
      null,

    position:
      error?.position ||
      null,

    status:
      error?.status ||
      error?.statusCode ||
      null,

    cause:
      error?.cause?.message ||
      null,

    stack:
      error?.stack ||
      null,
  };
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
    const startedAt =
      Date.now();

    const errorId =
      createErrorId();

    const name =
      String(
        req.body?.name ||
          ""
      ).trim();

    const parsedArguments =
      parseArguments(
        req.body?.arguments
      );

    const user =
      userFromRequest(req);

    try {
      if (!name) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Tool name is required.",
          });
      }

      console.log(
        "[executive-voice-tools] execution started:",
        {
          error_id:
            errorId,

          name,

          arguments:
            parsedArguments,

          user_id:
            user?.id ||
            user?.userId ||
            null,

          firm_id:
            user?.firm_id ||
            null,
        }
      );

      const output =
        await executeExecutiveVoiceTool({
          name,

          arguments:
            parsedArguments,

          user,
        });

      console.log(
        "[executive-voice-tools] execution completed:",
        {
          error_id:
            errorId,

          name,

          ok:
            Boolean(
              output?.ok
            ),

          tool:
            output?.tool ||
            name,

          degraded:
            Boolean(
              output?.degraded
            ),

          warning_count:
            Array.isArray(
              output?.warnings
            )
              ? output.warnings.length
              : 0,

          source_count:
            Array.isArray(
              output?.sources
            )
              ? output.sources.length
              : 0,

          duration_ms:
            Date.now() -
            startedAt,
        }
      );

      return res
        .status(200)
        .json(output);
    } catch (error) {
      const details =
        safeErrorDetails(
          error
        );

      console.error(
        "[executive-voice-tools] execution failed:",
        {
          error_id:
            errorId,

          name:
            name ||
            null,

          arguments:
            parsedArguments,

          user_id:
            user?.id ||
            user?.userId ||
            null,

          firm_id:
            user?.firm_id ||
            null,

          duration_ms:
            Date.now() -
            startedAt,

          ...details,
        }
      );

      return res
        .status(500)
        .json({
          ok: false,

          tool:
            name ||
            null,

          error:
            "Executive Voice live-data tool execution failed.",

          error_id:
            errorId,

          /*
           * Temporary Build 3.5.3 diagnostics.
           * Remove expose_detail after the issue is resolved.
           */
          detail:
            details.message,

          error_name:
            details.name,

          error_code:
            details.code,

          database_detail:
            details.detail,

          database_hint:
            details.hint,

          database_table:
            details.table,

          database_column:
            details.column,

          cause:
            details.cause,

          generated_at:
            new Date().toISOString(),
        });
    }
  }
);

export default router;
