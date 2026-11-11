import express from "express";

import {
  getMailOpsDashboard,
  getMailOpsOptions,
  listMailOpsEvents,
  createMailOpsEvent,
  updateMailOpsEvent,
} from "../controllers/mailops.controller.js";

import { mailopsIv } from "../controllers/mailopsIv.controller.js";

import { mailopsCampaign } from "../controllers/mailopsCampaign.controller.js";
const router = express.Router();
router.get("/iv/campaigns/status", mailopsCampaign.status);
router.get("/iv/campaigns", mailopsCampaign.list);
router.post("/iv/campaigns", mailopsCampaign.create);
router.post("/iv/campaigns/:id/manifest", mailopsCampaign.manifest);
router.post("/iv/campaigns/:id/feed-token", mailopsCampaign.token);
router.get("/iv/campaigns/:id", mailopsCampaign.summary);
router.post("/iv/campaigns/:id/events", mailopsCampaign.events);

router.get("/iv/status", mailopsIv.status);
router.post("/iv/lookup", mailopsIv.lookup);

router.get("/dashboard", getMailOpsDashboard);
router.get("/options", getMailOpsOptions);
router.get("/events", listMailOpsEvents);
router.post("/events", createMailOpsEvent);
router.patch("/events/:eventId", updateMailOpsEvent);

export default router;
