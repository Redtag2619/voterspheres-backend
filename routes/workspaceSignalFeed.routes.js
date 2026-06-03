import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getWorkspaceSignalFeed } from "../services/workspaceSignalFeed.service.js";

const router = express.Router();

router.get("/:workspaceId", requireAuth, async (req, res) => {
  try {
    const data = await getWorkspaceSignalFeed({
      user: req.user || req.auth || {},
      workspaceId: req.params.workspaceId,
    });

    return res.json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error("[workspace-signal-feed] failed", error);

    return res.status(500).json({
      error: "Failed to load workspace signal feed.",
      detail: error.message,
    });
  }
});

export default router;
