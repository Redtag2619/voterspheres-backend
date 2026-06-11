import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  deleteBetaCustomer,
  getBetaOnboarding,
  saveBetaCustomer,
  updateBetaCustomerStage,
} from "../services/betaOnboarding.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getBetaOnboarding({
      user: req.user || req.auth || {},
      stage: req.query.stage || "",
      q: req.query.q || "",
      priority: req.query.priority || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] failed", error);
    return res.status(500).json({
      error: "Failed to load Beta Onboarding Center.",
      detail: error.message,
    });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const data = await saveBetaCustomer({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] save failed", error);
    return res.status(500).json({
      error: "Failed to save beta customer.",
      detail: error.message,
    });
  }
});

router.post("/:id/stage", requireAuth, async (req, res) => {
  try {
    const data = await updateBetaCustomerStage({
      user: req.user || req.auth || {},
      id: req.params.id,
      stage: req.body?.stage || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] stage failed", error);
    return res.status(500).json({
      error: "Failed to update beta customer stage.",
      detail: error.message,
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const data = await deleteBetaCustomer({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] delete failed", error);
    return res.status(500).json({
      error: "Failed to delete beta customer.",
      detail: error.message,
    });
  }
});

export default router;
