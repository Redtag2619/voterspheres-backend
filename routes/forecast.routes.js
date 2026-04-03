import express from "express";
import {
  getForecast,
  getForecastSummary,
  getForecastOverlays,
  getForecastRankings,
  rebuildForecastSnapshot
} from "../services/forecast.service.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const data = await getForecast();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load forecast"
    });
  }
});

router.get("/published", async (_req, res) => {
  try {
    const data = await getForecast();
    res.status(200).json({
      published_at: data?.snapshot?.published_at || null,
      races: data?.races || [],
      metrics: data?.metrics || [],
      scenarios: data?.scenarios || [],
      notes: data?.notes || []
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load published forecast"
    });
  }
});

router.get("/summary", async (_req, res) => {
  try {
    const data = await getForecastSummary();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load forecast summary"
    });
  }
});

router.get("/map", async (_req, res) => {
  try {
    const data = await getForecastOverlays();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load forecast map"
    });
  }
});

router.get("/battlegrounds", async (_req, res) => {
  try {
    const data = await getForecast();
    res.status(200).json(data?.battlegrounds || []);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load battlegrounds"
    });
  }
});

router.get("/rankings", async (_req, res) => {
  try {
    const data = await getForecastRankings();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load forecast rankings"
    });
  }
});

router.post("/rebuild", async (req, res) => {
  try {
    const data = await rebuildForecastSnapshot(req.body || {});
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to rebuild forecast snapshot"
    });
  }
});

export default router;
