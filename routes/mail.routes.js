import express from "express";
import {
  createMailEvent,
  getMailDashboard,
  getMailIntelligenceSummary,
  getMailTimeline
} from "../services/mail.service.js";

const router = express.Router();

router.get("/dashboard", async (_req, res) => {
  try {
    const data = await getMailDashboard();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load mail dashboard" });
  }
});

router.get("/timeline", async (_req, res) => {
  try {
    const data = await getMailTimeline();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load mail timeline" });
  }
});

router.get("/intelligence/summary", async (_req, res) => {
  try {
    const data = await getMailIntelligenceSummary();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load mail intelligence" });
  }
});

router.post("/events", async (req, res) => {
  try {
    const data = await createMailEvent(req.body || {});
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create mail event" });
  }
});

export default router;
