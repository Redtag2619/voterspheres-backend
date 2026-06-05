import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getNationalElectionCommandCenter } from "../services/nationalElectionCommandCenter.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getNationalElectionCommandCenter({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[national-command] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load National Election Command Center.",
      detail: error.message,
    });
  }
});

export default router;
