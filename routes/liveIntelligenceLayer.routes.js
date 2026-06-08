import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getLiveIntelligenceLayer } from "../services/liveIntelligenceLayer.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLiveIntelligenceLayer({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[live-intelligence-layer] failed", error);
    return res.status(500).json({
      error: "Failed to load Live Intelligence Layer.",
      detail: error.message,
    });
  }
});

export default router;
