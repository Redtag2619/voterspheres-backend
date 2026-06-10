import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getLaunchReadiness } from "../services/launchReadiness.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLaunchReadiness({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-readiness] failed", error);
    return res.status(500).json({
      error: "Failed to load Launch Readiness Dashboard.",
      detail: error.message,
    });
  }
});

export default router;
