import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getNarrativeDashboard,
  importNewsNarrativeSignals,
} from "../services/newsNarrativeIngestion.service.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const data = await getNarrativeDashboard({ firmId });
    return res.json({ ok: true, ...data });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load news narrative dashboard.",
      detail: error.message,
    });
  }
});

router.post("/ingest", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const result = await importNewsNarrativeSignals({
      firmId,
      feeds: Array.isArray(req.body?.feeds) && req.body.feeds.length ? req.body.feeds : undefined,
      limitPerFeed: Number(req.body?.limit || 25),
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to ingest news narrative signals.",
      detail: error.message,
    });
  }
});

export default router;
