import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  archiveNotification,
  createNotificationEvent,
  getNotificationCenter,
  markNotificationRead,
} from "../services/notificationCenter.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getNotificationCenter({
      user: req.user || req.auth || {},
      filters: {
        q: req.query.q || "",
        level: req.query.level || "",
        category: req.query.category || "",
        source: req.query.source || "",
        state: req.query.state || "",
      },
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[notification-center] load failed", error);
    return res.status(500).json({
      error: "Failed to load Notification Center.",
      detail: error.message,
    });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const notification = await createNotificationEvent({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, notification });
  } catch (error) {
    console.error("[notification-center] create failed", error);
    return res.status(500).json({
      error: "Failed to create notification.",
      detail: error.message,
    });
  }
});

router.put("/:id/read", requireAuth, async (req, res) => {
  try {
    const result = await markNotificationRead({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json(result);
  } catch (error) {
    console.error("[notification-center] read failed", error);
    return res.status(500).json({
      error: "Failed to mark notification read.",
      detail: error.message,
    });
  }
});

router.put("/:id/archive", requireAuth, async (req, res) => {
  try {
    const result = await archiveNotification({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json(result);
  } catch (error) {
    console.error("[notification-center] archive failed", error);
    return res.status(500).json({
      error: "Failed to archive notification.",
      detail: error.message,
    });
  }
});

export default router;
