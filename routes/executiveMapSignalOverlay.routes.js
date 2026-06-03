import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getExecutiveMapSignalOverlay } from "../services/executiveMapSignalOverlay.service.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const data = await getExecutiveMapSignalOverlay({ firmId });

    return res.json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error("[executive-map-signal-overlay] failed", error);

    return res.status(500).json({
      error: "Failed to load executive map signal overlay.",
      detail: error.message,
    });
  }
});

export default router;
