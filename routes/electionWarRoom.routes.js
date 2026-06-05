import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getElectionWarRoom } from "../services/electionWarRoom.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getElectionWarRoom({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[election-war-room] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load Election War Room.",
      detail: error.message,
    });
  }
});

export default router;
