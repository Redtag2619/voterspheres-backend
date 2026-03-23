import express from "express"; 
import {
  getAllAlerts,
  getCampaignAlerts,
  rebuildAlerts,
  resolveAlert,
  dismissAlert
} from "../services/alerts.service.js";

const router = express.Router();

router.get("/", getAllAlerts);
router.get("/campaigns/:id", getCampaignAlerts);
router.post("/rebuild", rebuildAlerts);
router.post("/resolve", resolveAlert);
router.post("/dismiss", dismissAlert);

export default router;
