import express from "express";
import {
  createCheckoutSessionForFirm,
  createPortalSessionForFirm,
  getBillingConfig,
  getBillingDebugForFirm,
  handleStripeWebhook,
} from "../services/billing.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import pool from "../config/database.js";

const router = express.Router();

function isTestModeEnabled() {
  return String(process.env.BILLING_TEST_MODE || "false").toLowerCase() === "true";
}

router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];
    const rawBody = req.body;

    const result = await handleStripeWebhook({
      rawBody,
      signature,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      error: error.message || "Webhook failed",
    });
  }
});

router.get("/config", async (_req, res) => {
  try {
    const data = await getBillingConfig();

    res.status(200).json({
      ...data,
      billing_test_mode: isTestModeEnabled(),
    });
  } catch (error) {
    res.status(500).json({
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

    res.status(200).json({
      ...data,
      email: req.user?.email || null,
      billing_test_mode: isTestModeEnabled(),
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load billing debug info",
    });
  }
});

router.post("/test/activate-plan", requireAuth, async (req, res) => {
  try {
    if (!isTestModeEnabled()) {
      return res.status(403).json({
        error: "Billing test mode is disabled",
      });
    }

    const firmId = req.auth?.firmId || req.user?.firm_id;
    const { plan = "starter" } = req.body || {};

    const normalizedPlan = String(plan || "starter").toLowerCase();
    const allowedPlans = ["starter", "pro", "enterprise"];

    if (!allowedPlans.includes(normalizedPlan)) {
      return res.status(400).json({
        error: "Invalid plan",
      });
    }

    const result = await pool.query(
      `
        update firms
        set
          plan_tier = $2,
          status = 'active',
          stripe_customer_id = coalesce(stripe_customer_id, 'test_customer'),
          stripe_subscription_id = coalesce(stripe_subscription_id, 'test_subscription'),
          updated_at = now()
        where id = $1
        returning
          id,
          name,
          plan_tier,
          status,
          stripe_customer_id,
          stripe_subscription_id
      `,
      [firmId, normalizedPlan]
    );

    const firm = result.rows?.[0];

    if (!firm) {
      return res.status(404).json({ error: "Firm not found" });
    }

    return res.status(200).json({
      ok: true,
      mode: "test",
      message: `Activated ${normalizedPlan} plan in free test mode`,
      firm,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to activate test plan",
    });
  }
});

async function checkoutHandler(req, res) {
  try {
    const firmId = req.auth?.firmId || req.user?.firm_id;
    const email = req.user?.email || null;
    const { priceId, plan } = req.body || {};

    if (isTestModeEnabled()) {
      const normalizedPlan = String(plan || "starter").toLowerCase();
      const allowedPlans = ["starter", "pro", "enterprise"];

      if (!allowedPlans.includes(normalizedPlan)) {
        return res.status(400).json({
          error: "Invalid plan for test mode",
        });
      }

      const result = await pool.query(
        `
          update firms
          set
            plan_tier = $2,
            status = 'active',
            stripe_customer_id = coalesce(stripe_customer_id, 'test_customer'),
            stripe_subscription_id = coalesce(stripe_subscription_id, 'test_subscription'),
            updated_at = now()
          where id = $1
          returning id, name, plan_tier, status
        `,
        [firmId, normalizedPlan]
      );

      return res.status(200).json({
        id: `test_checkout_${Date.now()}`,
        url: `${process.env.FRONTEND_URL || "https://www.voterspheres.org"}/billing?checkout=success&test_mode=1&plan=${normalizedPlan}`,
        mode: "test",
        firm: result.rows?.[0] || null
