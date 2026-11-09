import express from "express";

import {
  getMailOpsDashboard,
  getMailOpsOptions,
  listMailOpsEvents,
  createMailOpsEvent,
  updateMailOpsEvent,
} from "../controllers/mailops.controller.js";

import { mailopsIv } from "../controllers/mailopsIv.controller.js";

const router = express.Router();

router.get("/iv/status", mailopsIv.status);
router.post("/iv/lookup", mailopsIv.lookup);

router.get("/dashboard", getMailOpsDashboard);
router.get("/options", getMailOpsOptions);
router.get("/events", listMailOpsEvents);
router.post("/events", createMailOpsEvent);
router.patch("/events/:eventId", updateMailOpsEvent);

export default router;
