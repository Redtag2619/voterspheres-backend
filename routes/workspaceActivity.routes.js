import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getWorkspaceActivity } from "../services/workspaceActivity.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getWorkspaceActivity({
      user: req.user || req.auth || {},
    });

    res.json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to load workspace activity",
    });
  }
});

export default router;
