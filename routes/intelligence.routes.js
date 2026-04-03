import express from "express";
import {
  getForecast,
  getForecastOverlays,
  getForecastRankings,
  getForecastSummary,
  rebuildForecastSnapshot
} from "../services/forecast.service.js";

const router = express.Router();

router.get("/summary", async (_req, res) => {
  try {
    const data = await getForecastSummary();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load intelligence summary" });
  }
});

router.get("/dashboard", async (_req, res) => {
  try {
    const data = await getForecast();
    res.status(200).json({
      metrics: data.metrics,
      battlegrounds: data.battlegrounds,
      snapshot: data.snapshot
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load intelligence dashboard" });
  }
});

router.get("/forecast", async (_req, res) => {
  try {
    const data = await getForecast();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load forecast" });
  }
});

router.get("/rankings", async (_req, res) => {
  try {
    const data = await getForecastRankings();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load rankings" });
  }
});

router.get("/map", async (_req, res) => {
  try {
    const data = await getForecastOverlays();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load map overlays" });
  }
});

router.post("/forecast/rebuild", async (req, res) => {
  try {
    const data = await rebuildForecastSnapshot(req.body || {});
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to rebuild forecast snapshot" });
  }
});

export default router;
