import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getProductionHardening } from "../services/productionHardening.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getProductionHardening({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[production-hardening] failed", error);
    return res.status(500).json({
      error: "Failed to load Production Hardening Center.",
      detail: error.message,
    });
  }
});

export default router;
