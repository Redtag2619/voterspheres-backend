import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createNarrativeRapidResponse,
  getNarrativeRapidResponseDashboard,
  updateNarrativeRapidResponse,
} from "../services/narrativeRapidResponse.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getNarrativeRapidResponseDashboard({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[narrative-response] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load narrative rapid response dashboard.",
      detail: error.message,
    });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const response = await createNarrativeRapidResponse({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, response });
  } catch (error) {
    console.error("[narrative-response] create failed", error);
    return res.status(500).json({
      error: "Failed to create narrative rapid response.",
      detail: error.message,
    });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const response = await updateNarrativeRapidResponse({
      user: req.user || req.auth || {},
      id: req.params.id,
      payload: req.body || {},
    });

    return res.json({ ok: true, response });
  } catch (error) {
    console.error("[narrative-response] update failed", error);
    return res.status(500).json({
      error: "Failed to update narrative rapid response.",
      detail: error.message,
    });
  }
});

export default router;
