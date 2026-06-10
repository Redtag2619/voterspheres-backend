import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  deleteLaunchAsset,
  getLaunchAssets,
  updateLaunchAssetStatus,
  upsertLaunchAsset,
} from "../services/launchAssets.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLaunchAssets({
      user: req.user || req.auth || {},
      category: req.query.category || "",
      status: req.query.status || "",
      q: req.query.q || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-assets] failed", error);
    return res.status(500).json({
      error: "Failed to load Launch Asset Center.",
      detail: error.message,
    });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const data = await upsertLaunchAsset({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-assets] save failed", error);
    return res.status(500).json({
      error: "Failed to save launch asset.",
      detail: error.message,
    });
  }
});

router.post("/:id/status", requireAuth, async (req, res) => {
  try {
    const data = await updateLaunchAssetStatus({
      user: req.user || req.auth || {},
      id: req.params.id,
      status: req.body?.status || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-assets] status failed", error);
    return res.status(500).json({
      error: "Failed to update launch asset status.",
      detail: error.message,
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const data = await deleteLaunchAsset({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-assets] delete failed", error);
    return res.status(500).json({
      error: "Failed to delete launch asset.",
      detail: error.message,
    });
  }
});

export default router;
