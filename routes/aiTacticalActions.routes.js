import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createAiTacticalTask } from "../services/aiTacticalActions.service.js";

const router = express.Router();

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
    console.error("[ai-tactical-actions] create task failed", error);

    return res.status(500).json({
      error: "Failed to create AI Tactical task.",
      detail: error.message,
    });
  }
});

export default router;
