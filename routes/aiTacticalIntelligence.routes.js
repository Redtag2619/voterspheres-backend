import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getAiTacticalDashboard,
  getAiTacticalWorkspace,
} from "../services/aiTacticalIntelligence.service.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const data = await getAiTacticalDashboard({ firmId });
    return res.json({ ok: true, ...data });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load AI tactical dashboard.",
      detail: error.message,
    });
  }
});

router.get("/workspace/:id", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const data = await getAiTacticalWorkspace({
      firmId,
      workspaceId: req.params.id,
    });

    return res.json({ ok: true, intelligence: data });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load workspace AI tactical intelligence.",
      detail: error.message,
    });
  }
});

export default router;
