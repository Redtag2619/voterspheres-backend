import express from "express";
import {
  createMailDropHandler,
  createMailProgramHandler,
  createMailTrackingEventHandler,
  getCampaignMailTimelineHandler,
  getMailDashboardHandler,
  getMailDropTimelineHandler,
  getPlatformMailTimelineHandler,
  initMailTables,
  listMailDropsHandler,
  listMailProgramsHandler
} from "../services/mail.service.js";

const router = express.Router();

router.post("/init", initMailTables);

router.get("/dashboard", getMailDashboardHandler);

router.get("/programs", listMailProgramsHandler);
router.post("/programs", createMailProgramHandler);

router.get("/drops", listMailDropsHandler);
router.post("/drops", createMailDropHandler);

router.post("/tracking-events", createMailTrackingEventHandler);
router.get("/timeline", getPlatformMailTimelineHandler);
router.get("/campaigns/:campaignId/timeline", getCampaignMailTimelineHandler);
router.get("/drops/:id/timeline", getMailDropTimelineHandler);

export default router;
