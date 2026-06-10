import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  advanceRevenueDeal,
  createDealFromOpportunity,
  createRevenueDeal,
  deleteRevenueDeal,
  getRevenuePipeline,
  updateRevenueDeal,
} from "../services/revenuePipeline.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getRevenuePipeline({
      user: req.user || req.auth || {},
      stage: req.query.stage || "",
      state: req.query.state || "",
      q: req.query.q || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[revenue-pipeline] failed", error);
    return res.status(500).json({
      error: "Failed to load Revenue Pipeline.",
      detail: error.message,
    });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const data = await createRevenueDeal({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[revenue-pipeline] create failed", error);
    return res.status(500).json({
      error: "Failed to create revenue deal.",
      detail: error.message,
    });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const data = await updateRevenueDeal({
      user: req.user || req.auth || {},
      id: req.params.id,
      payload: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[revenue-pipeline] update failed", error);
    return res.status(500).json({
      error: "Failed to update revenue deal.",
      detail: error.message,
    });
  }
});

router.post("/:id/advance", requireAuth, async (req, res) => {
  try {
    const data = await advanceRevenueDeal({
      user: req.user || req.auth || {},
      id: req.params.id,
      stage: req.body?.stage || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[revenue-pipeline] advance failed", error);
    return res.status(500).json({
      error: "Failed to advance revenue deal.",
      detail: error.message,
    });
  }
});

router.post("/from-opportunity", requireAuth, async (req, res) => {
  try {
    const data = await createDealFromOpportunity({
      user: req.user || req.auth || {},
      opportunity: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[revenue-pipeline] opportunity conversion failed", error);
    return res.status(500).json({
      error: "Failed to convert opportunity into revenue deal.",
      detail: error.message,
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const data = await deleteRevenueDeal({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[revenue-pipeline] delete failed", error);
    return res.status(500).json({
      error: "Failed to delete revenue deal.",
      detail: error.message,
    });
  }
});

export default router;
