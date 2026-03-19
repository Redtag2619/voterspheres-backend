import express from "express";
import {
  addTrackingEvent,
  createDrop,
  createProgram,
  getCampaignMail,
  getDashboard,
  getDrops,
  getProgramDetail,
  getPrograms,
  getTrackingEvents,
  initMailModule
} from "../services/mail.service.js";

const router = express.Router();

router.post("/init", initMailModule);

router.get("/dashboard", getDashboard);

router.post("/programs", createProgram);
router.get("/programs", getPrograms);
router.get("/programs/:program_id", getProgramDetail);

router.post("/drops", createDrop);
router.get("/drops", getDrops);

router.post("/drops/:drop_id/events", addTrackingEvent);
router.get("/drops/:drop_id/events", getTrackingEvents);

router.get("/campaigns/:id", getCampaignMail);

export default router;
