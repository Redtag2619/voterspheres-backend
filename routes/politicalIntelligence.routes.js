import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getPoliticalIntelligenceGraph } from "../services/politicalIntelligence.service.js";

const router = express.Router();

router.get("/graph", requireAuth, async (req, res) => {
  try {
    const data = await getPoliticalIntelligenceGraph({
      user: req.user || req.auth || {},
      query: req.query.q || "",
      state: req.query.state || "",
      type: req.query.type || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[political-intelligence] graph failed", error);
    return res.status(500).json({
      error: "Failed to load Political Intelligence Graph.",
      detail: error.message,
    });
  }
});

export default router;
