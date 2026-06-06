import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getExecutiveRevenueIntelligence } from "../services/executiveRevenue.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getExecutiveRevenueIntelligence({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[executive-revenue] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load Executive Revenue Intelligence.",
      detail: error.message,
    });
  }
});

export default router;
