import express from "express";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingConfig,
  getBillingDebugMe,
  handleStripeWebhook
} from "../services/billing.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];

    const result = await handleStripeWebhook(req.body, signature);
    res.status(200).json(result);
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({ error: error.message || "Webhook failed" });
  }
});

router.get("/config", requireAuth, async (_req, res) => {
  try {
    const data = await getBillingConfig();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load billing config" });
  }
});

router.get("/debug/me", requireAuth, async (req, res) => {
  try {
    const data = await getBillingDebugMe(req);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load billing debug data" });
  }
});

router.post("/checkout-session", requireAuth, async (req, res) => {
  try {
    const data = await createCheckoutSession(req);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create checkout session" });
  }
});

router.post("/portal-session", requireAuth, async (req, res) => {
  try {
    const data = await createPortalSession(req);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create portal session" });
  }
});

export default router;
