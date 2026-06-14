import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getLaunchAutomation,
  runLaunchAutomationRefresh,
} from "../services/launchAutomation.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLaunchAutomation({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-automation] failed", error);
    return res.status(500).json({
      error: "Failed to load launch automation.",
      detail: error.message,
    });
  }
});

router.post("/refresh", requireAuth, async (req, res) => {
  try {
    const data = await runLaunchAutomationRefresh({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, refreshed: true, ...data });
  } catch (error) {
    console.error("[launch-automation] refresh failed", error);
    return res.status(500).json({
      error: "Failed to run launch automation refresh.",
      detail: error.message,
    });
  }
});

export default router;
