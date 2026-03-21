import express from "express";
import { getCampaignCommandCenter } from "../services/campaignCommand.service.js";

const router = express.Router();

router.get("/:id/command-center", getCampaignCommandCenter);

export default router;
