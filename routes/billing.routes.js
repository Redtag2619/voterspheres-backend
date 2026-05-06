import express from "express";
import {
  ensureBillingColumns,
  ensureStripeCustomerForFirm,
  getBillingPriceMap,
  getFirmById,
  handleStripeBillingEvent,
  stripe
} from "../services/billingPlan.service.js";
import requireAuth from "../middleware/auth.js";

const router = express.Router();

function text(value = "") {
  return String(value ?? "").trim();
}

function getUserId(req) {
  return req.auth?.userId || req.user?.id || null;
}

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

function publicAppUrl(req) {
  return (
    process.env.FRONTEND_URL ||
    process.env.VERCEL_FRONTEND_URL ||
    process.env.PUBLIC_URL ||
    req.headers.origin ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
}

function sanitizePlan(plan = "starter") {
  const value = text(plan).toLowerCase();

  if (value === "enterprise") return "enterprise";
  if (value === "pro") return "pro";
  return "starter";
}

function getPriceIdForPlan(plan = "starter", explicitPriceId = "") {
  if (explicitPriceId) return explicitPriceId;

  const prices = getBillingPriceMap();
  return prices[sanitizePlan(plan)] || "";
}

function buildSuccessUrl(req, plan = "pro") {
  const base = publicAppUrl(req);
  return `${base}/dashboard?checkout=success&plan=${encodeURIComponent(plan)}`;
}

function buildCancelUrl(req, plan = "pro") {
  const base = publicAppUrl(req);
  return `${base}/pricing?checkout=cancelled&upgrade=${encodeURIComponent(plan)}`;
}

router.get("/config", async (req, res) => {
  try {
    const prices = getBillingPriceMap();

    return res.json({
      ok: true,
      publishableKey:
        process.env.STRIPE_PUBLISHABLE_KEY ||
        process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
        "",
      prices,
      priceIds: prices,
      starter: prices.starter,
      pro: prices.pro,
      enterprise: prices.enterprise
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load billing config"
    });
  }
});

router.get("/debug/me", requireAuth, async (req, res) => {
  try {
    await ensureBillingColumns();

    const firmId = getFirmId(req);
    const firm = firmId ? await getFirmById(firmId) : null;

    return res.json({
      ok: true,
      user: req.user || null,
      auth: {
        userId: getUserId(req),
        firmId,
        planTier: req.auth?.planTier || req.user?.plan_tier || "starter",
        role: req.auth?.role || req.user?.role || "user"
      },
      firm: firm
        ? {
            id: firm.id,
            name: firm.name,
            slug: firm.slug,
            plan_tier: firm.plan_tier || "starter",
            status: firm.status || "active",
            subscription_status: firm.subscription_status || null,
            current_period_end: firm.current_period_end || null,
            stripe_customer_id: firm.stripe_customer_id || null,
            stripe_subscription_id: firm.stripe_subscription_id || null,
            billing_updated_at: firm.billing_updated_at || null
          }
        : null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load billing debug"
    });
  }
});

router.post("/checkout-session", requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    await ensureBillingColumns();

    const firmId = getFirmId(req);
    const userId = getUserId(req);

    if (!firmId) {
      return res.status(400).json({ error: "Missing firm context" });
    }

    const firm = await getFirmById(firmId);

    if (!firm) {
      return res.status(404).json({ error: "Firm not found" });
    }

    const plan = sanitizePlan(req.body?.plan || req.body?.planTier || "pro");
    const priceId = getPriceIdForPlan(plan, req.body?.priceId || req.body?.price_id || "");

    if (!priceId) {
      return res.status(400).json({
        error: `Missing Stripe price id for ${plan}`
      });
    }

    const customerId = await ensureStripeCustomerForFirm({
      firm,
      user: req.user
    });

    const successUrl = text(req.body?.successUrl) || buildSuccessUrl(req, plan);
    const cancelUrl = text(req.body?.cancelUrl) || buildCancelUrl(req, plan);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        firm_id: String(firm.id),
        user_id: userId ? String(userId) : "",
        plan,
        plan_tier: plan
      },
      subscription_data: {
        metadata: {
          firm_id: String(firm.id),
          user_id: userId ? String(userId) : "",
          plan,
          plan_tier: plan
        }
      }
    });

    return res.json({
      ok: true,
      id: session.id,
      url: session.url,
      checkout_url: session.url,
      session
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create checkout session"
    });
  }
});

router.post("/portal-session", requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    await ensureBillingColumns();

    const firmId = getFirmId(req);

    if (!firmId) {
      return res.status(400).json({ error: "Missing firm context" });
    }

    const firm = await getFirmById(firmId);

    if (!firm) {
      return res.status(404).json({ error: "Firm not found" });
    }

    const customerId = await ensureStripeCustomerForFirm({
      firm,
      user: req.user
    });

    const returnUrl =
      text(req.body?.returnUrl) ||
      text(req.body?.return_url) ||
      `${publicAppUrl(req)}/billing`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });

    return res.json({
      ok: true,
      url: session.url,
      portal_url: session.url,
      session
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create billing portal session"
    });
  }
});

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
      const signature = req.headers["stripe-signature"];

      let event;

      if (webhookSecret) {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } else {
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : JSON.stringify(req.body || {});
        event = JSON.parse(rawBody);
      }

      const firm = await handleStripeBillingEvent(event);

      console.log("✅ Stripe billing webhook processed", {
        type: event.type,
        firm_id: firm?.id || null,
        plan_tier: firm?.plan_tier || null,
        subscription_status: firm?.subscription_status || null
      });

      return res.json({
        received: true,
        type: event.type,
        firm_id: firm?.id || null,
        plan_tier: firm?.plan_tier || null
      });
    } catch (error) {
      console.error("❌ Stripe webhook failed:", error);

      return res.status(400).json({
        error: error.message || "Stripe webhook failed"
      });
    }
  }
);

export default router;
