import express from "express";
import {
  getBattlegroundDashboardData,
  getCandidateIntelligenceSummary,
  getExecutiveFeedEvents,
  getFundraisingLeaderboard,
  getIntelligenceCommand,
  getIntelligenceDashboard,
  getIntelligenceForecast,
  getIntelligenceMap,
  getIntelligenceRankings,
  getIntelligenceSummary,
  getLiveFundraising
} from "../services/intelligence.service.js";
import {
  dispatchCrossSignalAlerts,
  getCrossSignalIntelligence
} from "../services/crossSignalIntelligence.service.js";

const router = express.Router();

function sendError(res, error, fallback) {
  res.status(500).json({
    error: error.message || fallback
  });
}

function liveRefreshEnabled() {
  return String(process.env.LIVE_REFRESH_ENABLED || "false").toLowerCase() === "true";
}

router.get("/status", async (_req, res) => {
  try {
    const summary = await getIntelligenceSummary();

    res.json({
      ok: true,
      service: "VoterSpheres Live Intelligence",
      status: "online",
      live_refresh_enabled: liveRefreshEnabled(),
      generated_at: new Date().toISOString(),
      summary: summary?.summary || {}
    });
  } catch (error) {
    sendError(res, error, "Failed to load intelligence status");
  }
});

router.post("/refresh", async (_req, res) => {
  try {
    const dashboard = await getIntelligenceDashboard();

    res.json({
      ok: true,
      refreshed: true,
      message: "Live intelligence refresh endpoint is online. Background refresh is manual-safe.",
      generated_at: new Date().toISOString(),
      summary: dashboard?.summary || {}
    });
  } catch (error) {
    sendError(res, error, "Failed to refresh intelligence");
  }
});

router.get("/cross-signal", async (_req, res) => {
  try {
    res.json(await getCrossSignalIntelligence());
  } catch (error) {
    sendError(res, error, "Failed to load cross-signal intelligence");
  }
});

router.post("/cross-signal/dispatch-alerts", async (_req, res) => {
  try {
    res.json(await dispatchCrossSignalAlerts());
  } catch (error) {
    sendError(res, error, "Failed to dispatch cross-signal alerts");
  }
});

router.get("/summary", async (_req, res) => {
  try {
    res.json(await getIntelligenceSummary());
  } catch (error) {
    sendError(res, error, "Failed to load intelligence summary");
  }
});

router.get("/dashboard", async (_req, res) => {
  try {
    res.json(await getIntelligenceDashboard());
  } catch (error) {
    sendError(res, error, "Failed to load intelligence dashboard");
  }
});

router.get("/forecast", async (_req, res) => {
  try {
    res.json(await getIntelligenceForecast());
  } catch (error) {
    sendError(res, error, "Failed to load intelligence forecast");
  }
});

router.get("/rankings", async (_req, res) => {
  try {
    res.json(await getIntelligenceRankings());
  } catch (error) {
    sendError(res, error, "Failed to load intelligence rankings");
  }
});

router.get("/map", async (_req, res) => {
  try {
    res.json(await getIntelligenceMap());
  } catch (error) {
    sendError(res, error, "Failed to load intelligence map");
  }
});

router.get("/feed", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 25), 100));
    res.json({ results: await getExecutiveFeedEvents(limit) });
  } catch (error) {
    sendError(res, error, "Failed to load intelligence feed");
  }
});

router.get("/command", async (_req, res) => {
  try {
    res.json(await getIntelligenceCommand());
  } catch (error) {
    sendError(res, error, "Failed to load command intelligence");
  }
});

router.get("/fundraising/live", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 25), 100));
    res.json(await getLiveFundraising(limit));
  } catch (error) {
    sendError(res, error, "Failed to load live fundraising");
  }
});

router.get("/fundraising/leaderboard", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 25), 100));
    res.json(await getFundraisingLeaderboard(limit));
  } catch (error) {
    sendError(res, error, "Failed to load fundraising leaderboard");
  }
});

router.get("/candidate-summary", async (req, res) => {
  try {
    res.json(await getCandidateIntelligenceSummary(req.query || {}));
  } catch (error) {
    sendError(res, error, "Failed to load candidate intelligence summary");
  }
});

router.get("/battlegrounds", async (_req, res) => {
  try {
    res.json(await getBattlegroundDashboardData());
  } catch (error) {
    sendError(res, error, "Failed to load battleground dashboard data");
  }
});

export default router;
