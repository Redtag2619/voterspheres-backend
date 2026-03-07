import express from "express";
import { generateCampaignStrategy } from "../services/autopilot.service.js";

const router = express.Router();

router.post("/strategy", (req, res) => {

  try {

    const campaignData = req.body;

    const strategy = generateCampaignStrategy(campaignData);

    res.json({
      success: true,
      strategy
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      error: "Autopilot strategy generation failed"
    });

  }

});

export default router;
