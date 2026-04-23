import express from "express";
import {
  getFundraisingLeaderboard,
  getIntelligenceDashboard,
  getIntelligenceForecast,
  getIntelligenceMap,
  getIntelligenceRankings,
  getIntelligenceSummary,
  getLiveFundraising,
  getCandidateIntelligenceSummary,
  getBattlegroundDashboardData
} from "../services/intelligence.service.js";
import { runLiveIntelligenceRefresh } from "../services/intelligenceRefresh.service.js";
import { requireRoles } from "../middleware/roles.middleware.js";

const router = express.Router();

router.get("/summary", async (_req, res) => {
  try {
    const data = await getIntelligenceSummary();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load intelligence summary"
    });
  }
});

router.get("/dashboard", async (_req, res) => {
  try {
    const data = await getIntelligenceDashboard();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load intelligence dashboard"
    });
  }
});

router.get("/forecast", async (_req, res) => {
  try {
    const data = await getIntelligenceForecast();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load intelligence forecast"
    });
  }
});

router.get("/rankings", async (_req, res) => {
  try {
    const data = await getIntelligenceRankings();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load intelligence rankings"
    });
  }
});

router.get("/map", async (_req, res) => {
  try {
    const data = await getIntelligenceMap();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load intelligence map"
    });
  }
});

router.get("/fundraising/live", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 12), 100));
    const data = await getLiveFundraising(limit);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load live fundraising"
    });
  }
});

router.get("/fundraising/leaderboard", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 12), 100));
    const data = await getFundraisingLeaderboard(limit);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load fundraising leaderboard"
    });
  }
});

router.get("/candidate-summary", async (req, res) => {
  try {
    const data = await getCandidateIntelligenceSummary(req.query || {});
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate intelligence summary"
    });
  }
});

router.get("/battlegrounds", async (_req, res) => {
  try {
    const data = await getBattlegroundDashboardData();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load battleground dashboard data"
    });
  }
});

router.post("/refresh", requireRoles("admin"), async (_req, res) => {
  try {
    const data = await runLiveIntelligenceRefresh();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to refresh live intelligence"
    });
  }
});

export default router;
