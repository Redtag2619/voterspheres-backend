import express from "express";
import {
  getAllAlerts,
  getCampaignAlerts,
  rebuildAlerts
} from "../services/alerts.service.js";

const router = express.Router();

router.get("/", getAllAlerts);
router.get("/campaigns/:id", getCampaignAlerts);
router.post("/rebuild", rebuildAlerts);

export default router;
