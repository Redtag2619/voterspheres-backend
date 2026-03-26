import express from "express";
import {
  getCampaignCommandCenter,
  getCampaignActivityTimeline,
  createCampaignCommandTask,
  createCampaignCommandContact,
  createCampaignCommandVendor,
  createCampaignCommandDocument,
  createCampaignCommandMailProgram,
  createCampaignCommandMailDrop,
  createCampaignCommandMailEvent,
  updateCampaignCommandTask,
  updateCampaignCommandVendor,
  updateCampaignCommandMailEvent
} from "../services/campaignCommand.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFirmAccessToCampaign } from "../middleware/firmAccess.middleware.js";
import { requirePlan } from "../middleware/planGuard.middleware.js";

const router = express.Router();

router.get(
  "/:id/command-center",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  getCampaignCommandCenter
);

router.get(
  "/:id/activity",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  getCampaignActivityTimeline
);

router.post(
  "/:id/tasks",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandTask
);

router.post(
  "/:id/contacts",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandContact
);

router.post(
  "/:id/vendors",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandVendor
);

router.post(
  "/:id/documents",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandDocument
);

router.post(
  "/:id/mail-programs",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandMailProgram
);

router.post(
  "/:id/mail-drops",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandMailDrop
);

router.post(
  "/:id/mail-events",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  createCampaignCommandMailEvent
);

router.patch(
  "/:id/tasks/:taskId",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  updateCampaignCommandTask
);

router.patch(
  "/:id/vendors/:vendorId",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  updateCampaignCommandVendor
);

router.patch(
  "/:id/mail-events/:eventId",
  requireAuth,
  requireFirmAccessToCampaign,
  requirePlan("pro"),
  updateCampaignCommandMailEvent
);

export default router;
