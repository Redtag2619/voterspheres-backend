import express from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import { createAiTacticalTask } from "../services/aiTacticalActions.service.js";

const router = express.Router();

function sendRouteError(res, error, fallbackMessage) {
  const statusCode = Number(error?.statusCode) || 500;

  return res.status(statusCode).json({
    ok: false,

    error:
      statusCode >= 500
        ? fallbackMessage
        : error?.message || fallbackMessage,

    code: error?.code || undefined,

    detail:
      process.env.NODE_ENV === "production"
        ? undefined
        : error?.message,
  });
}

router.post("/task", requireAuth, async (req, res) => {
  try {
    const task = await createAiTacticalTask({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({
      ok: true,
      task,
    });
  } catch (error) {
    console.error("[ai-tactical-actions] create task failed", {
      message: error?.message,
      code: error?.code,
      statusCode: error?.statusCode,
      user_id: req.user?.id || req.auth?.userId || null,
      firm_id:
        req.auth?.firmId ||
        req.auth?.firm_id ||
        req.user?.firm_id ||
        null,
    });

    return sendRouteError(
      res,
      error,
      "Failed to create AI Tactical task."
    );
  }
});

export default router;
