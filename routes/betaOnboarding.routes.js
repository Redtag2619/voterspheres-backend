import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  deleteBetaCustomer,
  getBetaOnboarding,
  saveBetaCustomer,
  updateBetaCustomerStage,
} from "../services/betaOnboarding.service.js";

import { requirePlatformOperator, requireFirmContext } from "../middleware/authorization.middleware.js";

const router = express.Router();
router.use(requireAuth, requirePlatformOperator, requireFirmContext);

router.get("/", async (req, res) => {
  try {
    const data = await getBetaOnboarding({
      user: req.user,
      stage: req.query.stage || "",
      q: req.query.q || "",
      priority: req.query.priority || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] failed", error);
    return res.status(error.statusCode || 500).json({
      error: "Failed to load Beta Onboarding Center.",
      detail: error.statusCode ? error.message : "Unexpected server error.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = await saveBetaCustomer({
      user: req.user,
      payload: req.body || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] save failed", error);
    return res.status(error.statusCode || 500).json({
      error: "Failed to save beta customer.",
      detail: error.statusCode ? error.message : "Unexpected server error.",
    });
  }
});

router.post("/:id/stage", async (req, res) => {
  try {
    const data = await updateBetaCustomerStage({
      user: req.user,
      id: req.params.id,
      stage: req.body?.stage || "",
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] stage failed", error);
    return res.status(error.statusCode || 500).json({
      error: "Failed to update beta customer stage.",
      detail: error.statusCode ? error.message : "Unexpected server error.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const data = await deleteBetaCustomer({
      user: req.user,
      id: req.params.id,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[beta-onboarding] delete failed", error);
    return res.status(error.statusCode || 500).json({
      error: "Failed to delete beta customer.",
      detail: error.statusCode ? error.message : "Unexpected server error.",
    });
  }
});

export default router;
