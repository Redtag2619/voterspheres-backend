import express from "express";
import {
  createCheckoutSessionForFirm,
  createPortalSessionForFirm,
  getBillingConfig,
  getBillingDebugForFirm,
} from "../services/billing.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/config", async (_req, res) => {
  try {
    const data = await getBillingConfig();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to load billing config",
    });
  }
});

router.get("/debug/me", requireAuth, async (req, res) => {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;
    const data = await getBillingDebugForFirm(firmId);

    if (!data) {
      return res.status(404).json({ error: "Firm not found" });
    }

    return res.status(200).json({
      ...data,
      email: req.user?.email || data.email || null,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to load billing debug info",
    });
  }
});

async function checkoutHandler(req, res) {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;
    const email = req.user?.email || null;
    const { priceId } = req.body || {};

    if (!priceId) {
      return res.status(400).json({
        error: "priceId is required",
      });
    }

    const data = await createCheckoutSessionForFirm({
      firmId,
      email,
      priceId,
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to create checkout session",
    });
  }
}

async function portalHandler(req, res) {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;
    const data = await createPortalSessionForFirm({ firmId });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to create portal session",
    });
  }
}

router.post("/checkout-session", requireAuth, checkoutHandler);
router.post("/checkout/session", requireAuth, checkoutHandler);

router.post("/portal-session", requireAuth, portalHandler);
router.post("/portal", requireAuth, portalHandler);

router.get("/status", requireAuth, async (req, res) => {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;
    const data = await getBillingDebugForFirm(firmId);
    return res.status(200).json(data || {});
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to load billing status",
    });
  }
});

export default router;
