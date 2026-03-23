import express from "express";
import {
  getCampaignCommandCenter,
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

const router = express.Router();

router.get("/:id/command-center", getCampaignCommandCenter);

router.post("/:id/tasks", createCampaignCommandTask);
router.post("/:id/contacts", createCampaignCommandContact);
router.post("/:id/vendors", createCampaignCommandVendor);
router.post("/:id/documents", createCampaignCommandDocument);
router.post("/:id/mail-programs", createCampaignCommandMailProgram);
router.post("/:id/mail-drops", createCampaignCommandMailDrop);
router.post("/:id/mail-events", createCampaignCommandMailEvent);

router.patch("/:id/tasks/:taskId", updateCampaignCommandTask);
router.patch("/:id/vendors/:vendorId", updateCampaignCommandVendor);
router.patch("/:id/mail-events/:eventId", updateCampaignCommandMailEvent);

export default router;
