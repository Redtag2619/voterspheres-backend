import express from "express";
import {
  getAIChatData,
  getCommandCenterData,
  getSimulatorData,
  getWarRoomData,
  postAIChatPrompt,
  recordWarRoomThreat
} from "../services/platform.service.js";

const router = express.Router();

router.get("/ai-chat", async (_req, res) => {
  try {
    const data = await getAIChatData();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load AI chat data" });
  }
});

router.post("/ai-chat", async (req, res) => {
  try {
    const data = await postAIChatPrompt(req.body || {});
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to run AI prompt" });
  }
});

router.get("/war-room", async (_req, res) => {
  try {
    const data = await getWarRoomData();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load war room data" });
  }
});

router.post("/war-room/threats", async (req, res) => {
  try {
    const data = await recordWarRoomThreat(req.body || {});
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to record war room threat" });
  }
});

router.get("/simulator", async (_req, res) => {
  try {
    const data = await getSimulatorData();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load simulator data" });
  }
});

router.get("/command-center", async (_req, res) => {
  try {
    const data = await getCommandCenterData();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load command center data" });
  }
});

export default router;
