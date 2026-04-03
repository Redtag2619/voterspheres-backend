import Stripe from "stripe";
import { publishEvent } from "../lib/intelligence.events.js";

let stripeInstance = null;

function getStripe() {
  if (stripeInstance) return stripeInstance;

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return null;

  stripeInstance = new Stripe(apiKey);
  return stripeInstance;
}

async function getDb() {
  const candidates = [
    "../config/database.js",
    "../db.js",
    "../config/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      return mod.default || mod.db || mod.pool || mod.client || null;
    } catch {
      // keep trying
    }
  }

  return null;
}

async function safeQuery(sql, params = []) {
  try {
    const db = await getDb();
    if (!db) return { rows: [] };

    if (typeof db.query === "function") {
      return await db.query(sql, params);
    }

    if (typeof db.execute === "function") {
      const [rows] = await db.execute(sql, params);
      return { rows };
    }

    return { rows: [] };
  } catch {
    return { rows: [] };
  }
}

export async function getBillingConfig() {
  return {
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    plans: {
      starter: process.env.STRIPE_PRICE_STARTER || "",
      pro: process.env.STRIPE_PRICE_PRO || "",
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || ""
    }
  };
}

export async function getBillingDebugMe(req) {
  return {
    ok: true,
    authUser: req.user || null,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    publishableKeyConfigured: Boolean(process.env.STRIPE_PUBLISHABLE_KEY)
  };
}

export async function createCheckoutSession(req) {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Missing STRIPE_SECRET_KEY.");
  }

  const body = req.body || {};
  const user = req.user || {};

  const priceId = body.priceId;
  if (!priceId) {
    throw new Error("Missing priceId.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url:
      body.successUrl ||
      `${process.env.FRONTEND_URL || "https://www.voterspheres.org"}/billing/success`,
    cancel_url:
      body.cancelUrl ||
      `${process.env.FRONTEND_URL || "https://www.voterspheres.org"}/pricing`,
    customer_email: user.email || body.email || undefined,
    subscription_data: body.trialDays
      ? { trial_period_days: Number(body.trialDays) }
      : undefined,
    metadata: {
      firmId: String(user.firm_id || body.firmId || ""),
      userId: String(user.id || body.userId || ""),
      selectedPlan: String(body.selectedPlan || ""),
      source: "voterspheres_checkout"
    }
  });

  return { url: session.url, id: session.id };
}

export async function createPortalSession(req) {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Missing STRIPE_SECRET_KEY.");
  }

  const customerId =
    req.user?.stripe_customer_id || req.body?.customerId || process.env.TEST_STRIPE_CUSTOMER_ID;

  if (!customerId) {
    throw new Error("No Stripe customer available for billing portal.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url:
      req.body?.returnUrl ||
      `${process.env.FRONTEND_URL || "https://www.voterspheres.org"}/billing`
  });

  return { url: session.url };
}

async function updateFirmBillingRecord({
  firmId,
  customerId,
  subscriptionId,
  planTier,
  status
}) {
  if (!firmId) return;

  await safeQuery(
    `
      update firms
      set
        stripe_customer_id = coalesce($2, stripe_customer_id),
        stripe_subscription_id = coalesce($3, stripe_subscription_id),
        plan_tier = coalesce($4, plan_tier),
        status = coalesce($5, status)
      where id = $1
    `,
    [firmId, customerId || null, subscriptionId || null, planTier || null, status || null]
  );
}

function inferPlanTierFromPrice(priceId) {
  if (!priceId) return "starter";

  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return "enterprise";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";

  return "starter";
}

export async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Missing STRIPE_SECRET_KEY.");
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const firmId = session?.metadata?.firmId || null;
      const customerId = session?.customer || null;
      const subscriptionId = session?.subscription || null;

      await updateFirmBillingRecord({
        firmId,
        customerId,
        subscriptionId,
        planTier: null,
        status: "active"
      });

      publishEvent({
        type: "billing.checkout_completed",
        channel: `firm:${firmId || "unknown"}`,
        timestamp: new Date().toISOString(),
        payload: {
          firmId,
          customerId,
          subscriptionId,
          status: "active"
        }
      });

      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const priceId =
        subscription?.items?.data?.[0]?.price?.id || null;
      const planTier = inferPlanTierFromPrice(priceId);
      const status = subscription?.status || "inactive";

      const firmId =
        subscription?.metadata?.firmId ||
        subscription?.metadata?.firm_id ||
        null;

      await updateFirmBillingRecord({
        firmId,
        customerId: subscription?.customer || null,
        subscriptionId: subscription?.id || null,
        planTier,
        status
      });

      publishEvent({
        type: "billing.plan_updated",
        channel: `firm:${firmId || "unknown"}`,
        timestamp: new Date().toISOString(),
        payload: {
          firmId,
          planTier,
          status,
          subscriptionId: subscription?.id || null
        }
      });

      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const firmId = invoice?.metadata?.firmId || null;

      publishEvent({
        type: "billing.payment_failed",
        channel: `firm:${firmId || "unknown"}`,
        timestamp: new Date().toISOString(),
        payload: {
          firmId,
          invoiceId: invoice?.id || null,
          status: "payment_failed"
        }
      });

      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const firmId = invoice?.metadata?.firmId || null;

      publishEvent({
        type: "billing.invoice_paid",
        channel: `firm:${firmId || "unknown"}`,
        timestamp: new Date().toISOString(),
        payload: {
          firmId,
          invoiceId: invoice?.id || null,
          status: "paid"
        }
      });

      break;
    }

    default:
      break;
  }

  return { received: true, type: event.type };
}
