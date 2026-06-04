import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getExecutiveMissionControl } from "../services/executiveMissionControl.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getExecutiveMissionControl({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[executive-mission-control] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load Executive Mission Control.",
      detail: error.message,
    });
  }
});

export default router;
