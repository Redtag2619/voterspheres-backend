import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { universalSearch } from "../services/universalSearch.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await universalSearch({
      user: req.user || req.auth || {},
      q: req.query.q || "",
      type: req.query.type || "",
      state: req.query.state || "",
      limit: req.query.limit || 120,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[universal-search] failed", error);
    return res.status(500).json({
      error: "Failed to run universal search.",
      detail: error.message,
    });
  }
});

export default router;
