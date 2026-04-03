import express from "express";
import {
  createCampaignTask,
  createCampaignVendor,
  getCampaignActivity,
  getCampaignCommandCenter,
  updateCampaignTask,
  updateCampaignVendor
} from "../services/campaignCommand.service.js";
import { createMailEvent, updateMailEvent } from "../services/mail.service.js";

const router = express.Router();

router.get("/:campaignId/command-center", async (req, res) => {
  try {
    const data = await getCampaignCommandCenter(req.params.campaignId);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load campaign command center" });
  }
});

router.get("/:campaignId/activity", async (req, res) =>
