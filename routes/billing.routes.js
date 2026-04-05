import express from "express";
import {
  createCheckoutSessionForFirm,
  createPortalSessionForFirm,
  getBillingConfig,
  getBillingDebugForFirm,
  handleStripeWebhook
} from "../services/billing.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];
    const rawBody = req.body;

    const result = await handleStripeWebhook({
      rawBody,
      signature
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      error: error.message || "Webhook failed"
    });
  }
});

router.get("/config", async (_req, res) => {
  try {
    const data = await getBillingConfig();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load billing config"
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

    res.status(200).json({
      ...data,
      email: req.user?.email || null
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load billing debug info"
    });
  }
});

async function checkoutHandler(req, res) {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;
    const email = req.user?.email || null;
    const { priceId } = req.body || {};

    const data = await createCheckoutSessionForFirm({
      firmId,
      email,
      priceId
    });

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to create checkout session"
    });
  }
}

async function portalHandler(req, res) {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;

    const data = await createPortalSessionForFirm({ firmId });

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to create portal session"
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
    res.status(200).json(data || {});
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load billing status"
    });
  }
});

export default router;
