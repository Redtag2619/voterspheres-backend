import express from "express";
import {
  getForecast,
  getForecastOverlays,
  getForecastRankings,
  getForecastSummary,
  rebuildForecastSnapshot
} from "../services/forecast.service.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const data = await getForecast();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/published", async (_req, res) => {
  try {
    const data = await getForecast();

    res.json({
      published_at: data?.snapshot?.published_at || null,
      metrics: data.metrics,
      races: data.races,
      scenarios: data.scenarios,
      notes: data.notes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/overlays", async (_req, res) => {
  try {
    const data = await getForecastOverlays();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/rankings", async (_req, res) => {
  try {
    const data = await getForecastRankings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/summary", async (_req, res) => {
  try {
    const data = await getForecastSummary();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/rebuild", async (req, res) => {
  try {
    const data = await rebuildForecastSnapshot(req.body || {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
