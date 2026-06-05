import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  deleteReportExport,
  generateReportExport,
  getReportExport,
  listReportExports,
} from "../services/reportExport.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const exports = await listReportExports({
      user: req.user || req.auth || {},
      limit: req.query.limit || 50,
    });

    return res.json({ ok: true, exports });
  } catch (error) {
    console.error("[report-export] list failed", error);
    return res.status(500).json({
      error: "Failed to load report exports.",
      detail: error.message,
    });
  }
});

router.post("/generate", requireAuth, async (req, res) => {
  try {
    const exportRecord = await generateReportExport({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, export: exportRecord });
  } catch (error) {
    console.error("[report-export] generate failed", error);
    return res.status(500).json({
      error: "Failed to generate report export.",
      detail: error.message,
    });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const exportRecord = await getReportExport({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, export: exportRecord });
  } catch (error) {
    console.error("[report-export] get failed", error);
    return res.status(404).json({
      error: "Failed to load report export.",
      detail: error.message,
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const result = await deleteReportExport({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json(result);
  } catch (error) {
    console.error("[report-export] delete failed", error);
    return res.status(500).json({
      error: "Failed to delete report export.",
      detail: error.message,
    });
  }
});

export default router;
