import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getExecutiveWorkspaceDashboard,
  getExecutiveWorkspaces,
} from "../services/executiveWorkspace.service.js";

const router = express.Router();

router.get("/workspaces", requireAuth, async (req, res) => {
  try {
    const data = await getExecutiveWorkspaces({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[executive-workspace] workspaces failed", error);
    return res.status(500).json({
      error: "Failed to load executive workspaces.",
      detail: error.message,
    });
  }
});

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getExecutiveWorkspaceDashboard({
      user: req.user || req.auth || {},
      workspaceId: req.query.workspace_id || null,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[executive-workspace] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load Executive Workspace.",
      detail: error.message,
    });
  }
});

export default router;
