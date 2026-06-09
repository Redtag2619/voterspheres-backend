import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createOpportunityCrmContact,
  createOpportunityTask,
  getOpportunityEngine,
} from "../services/opportunityEngine.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getOpportunityEngine({
      user: req.user || req.auth || {},
      state: req.query.state || "",
      party: req.query.party || "",
      office: req.query.office || "",
      q: req.query.q || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[opportunity-engine] failed", error);
    return res.status(500).json({
      error: "Failed to load Opportunity Engine.",
      detail: error.message,
    });
  }
});

router.post("/crm-contact", requireAuth, async (req, res) => {
  try {
    const data = await createOpportunityCrmContact({
      user: req.user || req.auth || {},
      opportunity: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[opportunity-engine] crm contact failed", error);
    return res.status(500).json({
      error: "Failed to create CRM contact.",
      detail: error.message,
    });
  }
});

router.post("/task", requireAuth, async (req, res) => {
  try {
    const data = await createOpportunityTask({
      user: req.user || req.auth || {},
      opportunity: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[opportunity-engine] task failed", error);
    return res.status(500).json({
      error: "Failed to create opportunity task.",
      detail: error.message,
    });
  }
});

export default router;
