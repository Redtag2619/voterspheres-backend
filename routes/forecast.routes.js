import express from "express";
import {
  triggerForecastRebuild,
  getPublishedForecast,
  getPublishedOverlays
} from "../services/forecast.service.js";

const router = express.Router();

router.post("/rebuild", triggerForecastRebuild);
router.get("/published", getPublishedForecast);
router.get("/overlays", getPublishedOverlays);

export default router;
