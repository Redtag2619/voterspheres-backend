import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getDatabaseStability } from "../services/databaseStability.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getDatabaseStability();
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[database-stability] failed", error);
    return res.status(500).json({
      error: "Failed to load Database Stability Center.",
      detail: error.message,
    });
  }
});

export default router;
