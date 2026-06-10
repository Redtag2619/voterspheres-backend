import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getExecutiveKpis } from "../services/executiveKpi.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getExecutiveKpis({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[executive-kpi] failed", error);
    return res.status(500).json({
      error: "Failed to load Executive KPI Layer.",
      detail: error.message,
    });
  }
});

export default router;
