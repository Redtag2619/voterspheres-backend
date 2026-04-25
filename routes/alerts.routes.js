import express from "express";
import {
  getAllAlerts,
  getCampaignAlerts,
  rebuildAlerts,
  resolveAlert,
  dismissAlert
} from "../services/alerts.service.js";

const router = express.Router();

/**
 * EXISTING ROUTES (keep these)
 */
router.get("/", getAllAlerts);
router.get("/campaigns/:id", getCampaignAlerts);
router.post("/rebuild", rebuildAlerts);
router.post("/resolve", resolveAlert);
router.post("/dismiss", dismissAlert);

/**
 * 🔥 NEW: ALERT TERMINAL ROUTES
 */

/**
 * GET /api/alerts/rules
 * Returns alert routing rules (stubbed for now)
 */
router.get("/rules", async (_req, res) => {
  try {
    res.json({
      results: [
        {
          id: 1,
          name: "MailOps High Risk",
          channel: "mailops",
          destination: "slack",
          event_types: ["mail_update", "delay_alert"],
          min_severity: "high",
          is_active: true
        },
        {
          id: 2,
          name: "Fundraising Surges",
          channel: "finance",
          destination: "email",
          event_types: ["fundraising_update"],
          min_severity: "medium",
          is_active: true
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load rules" });
  }
});

/**
 * GET /api/alerts/deliveries
 * Returns alert delivery history
 */
router.get("/deliveries", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 25), 100));

    const results = Array.from({ length: limit }).map((_, i) => ({
      id: i + 1,
      status: "sent",
      channel: "slack",
      sent_at: new Date().toISOString(),
      payload: {
        event_type: "mail_update",
        title: "Mail Delay Detected",
        severity: i % 3 === 0 ? "high" : "medium",
        state: "GA",
        office: "Senate",
        risk: "Elevated",
        detail: "USPS scan delay detected in Fulton County"
      }
    }));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load deliveries" });
  }
});

/**
 * POST /api/alerts/dispatch
 * Simulates dispatching alerts
 */
router.post("/dispatch", async (_req, res) => {
  try {
    res.json({
      ok: true,
      dispatched: true,
      message: "Alert dispatch triggered successfully",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to dispatch alerts" });
  }
});

/**
 * PUT /api/alerts/rules/:id
 * Toggle rule active state
 */
router.put("/rules/:id", async (req, res) => {
  try {
    res.json({
      ok: true,
      updated: true,
      id: req.params.id,
      ...req.body
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update rule" });
  }
});

export default router;
