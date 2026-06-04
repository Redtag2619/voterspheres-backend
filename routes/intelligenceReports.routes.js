import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  deleteIntelligenceReport,
  generateIntelligenceReport,
  getIntelligenceReport,
  listIntelligenceReports,
} from "../services/intelligenceReports.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const reports = await listIntelligenceReports({
      user: req.user || req.auth || {},
      limit: req.query.limit || 50,
    });

    return res.json({ ok: true, reports });
  } catch (error) {
    console.error("[intelligence-reports] list failed", error);
    return res.status(500).json({
      error: "Failed to load intelligence reports.",
      detail: error.message,
    });
  }
});

router.post("/generate", requireAuth, async (req, res) => {
  try {
    const report = await generateIntelligenceReport({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, report });
  } catch (error) {
    console.error("[intelligence-reports] generate failed", error);
    return res.status(500).json({
      error: "Failed to generate intelligence report.",
      detail: error.message,
    });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const report = await getIntelligenceReport({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, report });
  } catch (error) {
    console.error("[intelligence-reports] get failed", error);
    return res.status(404).json({
      error: "Failed to load intelligence report.",
      detail: error.message,
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const result = await deleteIntelligenceReport({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json(result);
  } catch (error) {
    console.error("[intelligence-reports] delete failed", error);
    return res.status(500).json({
      error: "Failed to delete intelligence report.",
      detail: error.message,
    });
  }
});

export default router;
