import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  completeCampaignCrmActivity,
  createCampaignCrmActivity,
  createCampaignCrmContact,
  getCampaignWorkspaceCrmDashboard,
} from "../services/campaignWorkspaceCrm.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getCampaignWorkspaceCrmDashboard({
      user: req.user || req.auth || {},
      workspaceId: req.query.workspace_id || null,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[campaign-crm] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load campaign workspace CRM.",
      detail: error.message,
    });
  }
});

router.post("/contacts", requireAuth, async (req, res) => {
  try {
    const contact = await createCampaignCrmContact({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, contact });
  } catch (error) {
    console.error("[campaign-crm] contact create failed", error);
    return res.status(500).json({
      error: "Failed to create CRM contact.",
      detail: error.message,
    });
  }
});

router.post("/activities", requireAuth, async (req, res) => {
  try {
    const activity = await createCampaignCrmActivity({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, activity });
  } catch (error) {
    console.error("[campaign-crm] activity create failed", error);
    return res.status(500).json({
      error: "Failed to create CRM activity.",
      detail: error.message,
    });
  }
});

router.put("/activities/:id/complete", requireAuth, async (req, res) => {
  try {
    const activity = await completeCampaignCrmActivity({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, activity });
  } catch (error) {
    console.error("[campaign-crm] activity complete failed", error);
    return res.status(500).json({
      error: "Failed to complete CRM activity.",
      detail: error.message,
    });
  }
});

export default router;
