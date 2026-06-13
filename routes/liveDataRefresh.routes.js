import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getLiveDataRefreshStatus,
  runLiveDataRefresh,
} from "../services/liveDataRefresh.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLiveDataRefreshStatus({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[live-data-refresh] status failed", error);
    return res.status(500).json({
      error: "Failed to load Live Data Refresh Center.",
      detail: error.message,
    });
  }
});

router.post("/run", requireAuth, async (req, res) => {
  try {
    const data = await runLiveDataRefresh({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[live-data-refresh] run failed", error);
    return res.status(500).json({
      error: "Failed to run live data refresh.",
      detail: error.message,
    });
  }
});

export default router;
