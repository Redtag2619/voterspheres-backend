import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getAiStrategicAdvisor } from "../services/aiStrategicAdvisor.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getAiStrategicAdvisor({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[ai-strategic-advisor] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load AI Strategic Advisor.",
      detail: error.message,
    });
  }
});

export default router;
