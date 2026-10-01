import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  askAiCampaignCopilot,
  getAiCampaignCopilotThread,
  listAiCampaignCopilotThreads,
} from "../services/aiCampaignCopilot.service.js";

const router = express.Router();

router.get("/threads", requireAuth, async (req, res) => {
  try {
    const threads = await listAiCampaignCopilotThreads({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, threads });
  } catch (error) {
    console.error("[ai-campaign-copilot] threads failed", error);
    return res.status(500).json({
      error: "Failed to load Co-Pilot threads.",
      detail: error.message,
    });
  }
});

router.get("/threads/:id", requireAuth, async (req, res) => {
  try {
    const data = await getAiCampaignCopilotThread({
      user: req.user || req.auth || {},
      threadId: req.params.id,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[ai-campaign-copilot] thread failed", error);
    return res.status(404).json({
      error: "Failed to load Co-Pilot thread.",
      detail: error.message,
    });
  }
});

router.post("/ask", requireAuth, async (req, res) => {
  try {
    const data = await askAiCampaignCopilot({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    if (error?.code === "TEMPORAL_SCOPE_VIOLATION") {
      return res.status(422).json({
        ok: false,
        code: error.code,
        error: error.message,
        detail: error.message,
        violations: Array.isArray(error.violations) ? error.violations : [],
        cycle: error.cycle ?? null,
      });
    }

    console.error("[ai-campaign-copilot] ask failed", error);
    return res.status(500).json({
      error: "Failed to ask AI Campaign Co-Pilot.",
      detail: error.message,
    });
  }
});

export default router
