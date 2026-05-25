import express from "express";
import {
  getMailOpsDashboard,
  getMailOpsOptions,
  listMailOpsEvents,
  createMailOpsEvent,
  updateMailOpsEvent,
} from "../controllers/mailops.controller.js";

import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

// DASHBOARD
router.get("/dashboard", requireAuth, getMailOpsDashboard);
router.get("/options", requireAuth, getMailOpsOptions);

// EVENTS
router.get("/events", requireAuth, listMailOpsEvents);
router.post("/events", requireAuth, createMailOpsEvent);
router.patch("/events/:eventId", requireAuth, updateMailOpsEvent);

export default router;
