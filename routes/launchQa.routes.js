import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getLaunchQa } from "../services/launchQa.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLaunchQa({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-qa] failed", error);
    return res.status(500).json({
      error: "Failed to load Launch QA Center.",
      detail: error.message,
    });
  }
});

export default router;
