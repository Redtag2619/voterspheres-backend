import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getSignalWorkspaceMatchingDashboard,
  runSignalWorkspaceMatching,
} from "../services/signalWorkspaceMatching.service.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const data = await getSignalWorkspaceMatchingDashboard({ firmId });
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[signal-workspace-matching] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load signal matching dashboard.",
      detail: error.message,
    });
  }
});

router.post("/run", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ error: "Missing firm context" });

    const result = await runSignalWorkspaceMatching({
      firmId,
      onlyUnmatched: req.body?.onlyUnmatched !== false,
      limit: Number(req.body?.limit || 1000),
      minimumScore: Number(req.body?.minimumScore || 45),
    });

    return res.json(result);
  } catch (error) {
    console.error("[signal-workspace-matching] run failed", error);
    return res.status(500).json({
      error: "Failed to run signal workspace matching.",
      detail: error.message,
    });
  }
});

export default router;
