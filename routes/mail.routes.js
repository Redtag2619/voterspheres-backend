import express from "express";
import {
  addMailTrackingEventHandler,
  createMailProgramHandler,
  getCampaignMailTrackingHandler,
  getMailDashboardHandler,
  getMailProgramHandler,
  initMailModule,
  listMailProgramsHandler
} from "../services/mail.service.js";

const router = express.Router();

router.post("/init", initMailModule);
router.get("/dashboard", getMailDashboardHandler);
router.get("/programs", listMailProgramsHandler);
router.post("/programs", createMailProgramHandler);
router.get("/programs/:id", getMailProgramHandler);
router.post("/programs/:id/events", addMailTrackingEventHandler);
router.get("/campaigns/:campaignId", getCampaignMailTrackingHandler);

export default router;
