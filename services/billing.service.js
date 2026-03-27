import Stripe from "stripe";
import { pool } from "../db/pool.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function normalizePlanTier(value) {
  const v = String(value || "free").toLowerCase().trim();

  if (["starter", "basic"].includes(v)) return "starter";
  if (["pro", "professional"].includes(v)) return "pro";
  if (["enterprise", "business"].includes(v)) return "enterprise";
  return "free";
}

function mapPriceIdToPlanTier(priceId) {
  if (!priceId) return "free";

  if (
    process.env.STRIPE_PRICE_STARTER &&
    priceId === process.env.STRIPE_PRICE_STARTER
  ) {
    return "starter";
  }

  if (
    process.env.STRIPE_PRICE_PRO &&
    priceId === process.env.STRIPE_PRICE_PRO
  ) {
    return "pro";
  }

  if (
    process.env.STRIPE_PRICE_ENTERPRISE &&
    priceId === process.env.STRIPE_PRICE_ENTERPRISE
  ) {
    return "enterprise";
  }

  return "free";
}

function mapStripeStatusToFirmStatus(stripeStatus) {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";

    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return "past_due";

    case "canceled":
      return "canceled";

    case "paused":
      return "paused";

    default:
      return "inactive";
  }
}

function getSubscriptionPriceId(subscription) {
  return subscription?.items?.data?.[0]?.price?.id || null;
}

function getPlanTierFromSubscription(subscription) {
  const priceId = getSubscriptionPriceId(subscription);

  if (priceId) {
    const mapped = mapPriceIdToPlanTier(priceId);
    if (mapped !== "free") return mapped;
  }

  const metadataPlan =
    subscription?.metadata?.plan_tier ||
    subscription?.metadata?.plan ||
    subscription?.items?.data?.[0]?.price?.metadata?.plan_tier ||
    "free";

  return normalizePlanTier(metadataPlan);
}

export async function getFirmById(firmId) {
  const { rows } = await pool.query(
    `
      SELECT id, name, firm_name, email, status, plan_tier, stripe_customer_id, stripe_subscription_id
      FROM firms
      WHERE id = $1
      LIMIT 1
    `,
    [firmId]
  );

  return rows[0] || null;
}

export async function getFirmByStripeCustomerId(customerId) {
  if (!customerId) return null;

  const { rows } = await pool.query(
    `
      SELECT id, name, firm_name, email, status, plan_tier, stripe_customer_id, stripe_subscription_id
      FROM firms
      WHERE stripe_customer_id = $1
      LIMIT 1
    `,
    [customerId]
  );

  return rows[0] || null;
}

export async function getFirmByStripeSubscriptionId(subscriptionId) {
  if (!subscriptionId) return null;

  const { rows } = await pool.query(
    `
      SELECT id, name, firm_name, email, status, plan_tier, stripe_customer_id, stripe_subscription_id
      FROM firms
      WHERE stripe_subscription_id = $1
      LIMIT 1
    `,
    [subscriptionId]
  );

  return rows[0] || null;
}

export async function ensureStripeCustomerForFirm(firmId) {
  const firm = await getFirmById(firmId);

  if (!firm) {
    throw new Error(`Firm not found for id=${firmId}`);
  }

  if (firm.stripe_customer_id) {
    return firm.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: firm.email || undefined,
    name: firm.firm_name || firm.name || `Firm ${firm.id}`,
    metadata: {
      firm_id: String(firm.id),
    },
  });

  await pool.query(
    `
      UPDATE firms
      SET stripe_customer_id = $1,
          updated_at = NOW()
      WHERE id = $2
    `,
    [customer.id, firm.id]
  );

  return customer.id;
}

export async function createCheckoutSession({
  firmId,
  priceId,
  successUrl,
  cancelUrl,
}) {
  if (!firmId) throw new Error("firmId is required");
  if (!priceId) throw new Error("priceId is required");
  if (!successUrl) throw new Error("successUrl is required");
  if (!cancelUrl) throw new Error("cancelUrl is required");

  const customerId = await ensureStripeCustomerForFirm(firmId);
  const planTier = mapPriceIdToPlanTier(priceId);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(firmId),
    metadata: {
      firm_id: String(firmId),
      plan_tier: planTier,
    },
    subscription_data: {
      metadata: {
        firm_id: String(firmId),
        plan_tier: planTier,
      },
    },
  });

  return session;
}

export async function createBillingPortalSession({ customerId, returnUrl }) {
  if (!customerId) throw new Error("customerId is required");
  if (!returnUrl) throw new Error("returnUrl is required");

  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export function constructStripeEvent(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  if (!signature) {
    throw new Error("Missing Stripe signature");
  }

  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

async function attachCheckoutSessionToFirm(session) {
  const firmId =
    session?.metadata?.firm_id ||
    session?.client_reference_id ||
    null;

  if (!firmId) {
    console.warn("checkout.session.completed missing firm_id/client_reference_id");
    return null;
  }

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;

  const desiredPlan = session?.metadata?.plan_tier
    ? normalizePlanTier(session.metadata.plan_tier)
    : null;

  const { rows } = await pool.query(
    `
      UPDATE firms
      SET stripe_customer_id = COALESCE($1, stripe_customer_id),
          stripe_subscription_id = COALESCE($2, stripe_subscription_id),
          plan_tier = CASE
                        WHEN $3 IS NOT NULL THEN $3
                        ELSE plan_tier
                      END,
          status = CASE
                     WHEN $2 IS NOT NULL THEN 'active'
                     ELSE status
                   END,
          updated_at = NOW()
      WHERE id = $4
      RETURNING id, plan_tier, status, stripe_customer_id, stripe_subscription_id
    `,
    [stripeCustomerId, stripeSubscriptionId, desiredPlan, firmId]
  );

  return rows[0] || null;
}

async function syncSubscriptionToFirm(subscription) {
  const subscriptionId = subscription?.id || null;
  const customerId =
    typeof subscription?.customer === "string"
      ? subscription.customer
      : subscription?.customer?.id || null;

  const firmIdFromMetadata = subscription?.metadata?.firm_id || null;

  let firm = null;

  if (firmIdFromMetadata) {
    firm = await getFirmById(firmIdFromMetadata);
  }

  if (!firm && subscriptionId) {
    firm = await getFirmByStripeSubscriptionId(subscriptionId);
  }

  if (!firm && customerId) {
    firm = await getFirmByStripeCustomerId(customerId);
  }

  if (!firm) {
    console.warn(
      `No firm found for subscription sync. subscription=${subscriptionId}, customer=${customerId}`
    );
    return null;
  }

  let planTier = getPlanTierFromSubscription(subscription);
  let status = mapStripeStatusToFirmStatus(subscription.status);

  if (subscription.status === "canceled") {
    planTier = "free";
    status = "canceled";
  }

  const { rows } = await pool.query(
    `
      UPDATE firms
      SET stripe_customer_id = COALESCE($1, stripe_customer_id),
          stripe_subscription_id = COALESCE($2, stripe_subscription_id),
          plan_tier = $3,
          status = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, plan_tier, status, stripe_customer_id, stripe_subscription_id
    `,
    [customerId, subscriptionId, planTier, status, firm.id]
  );

  return rows[0] || null;
}

async function markFirmInvoicePaid(invoice) {
  const subscriptionId =
    typeof invoice?.subscription === "string"
      ? invoice.subscription
      : invoice?.subscription?.id || null;

  const customerId =
    typeof invoice?.customer === "string"
      ? invoice.customer
      : invoice?.customer?.id || null;

  let firm = null;

  if (subscriptionId) {
    firm = await getFirmByStripeSubscriptionId(subscriptionId);
  }

  if (!firm && customerId) {
    firm = await getFirmByStripeCustomerId(customerId);
  }

  if (!firm) {
    console.warn(
      `No firm found for invoice.paid. subscription=${subscriptionId}, customer=${customerId}`
    );
    return null;
  }

  const { rows } = await pool.query(
    `
      UPDATE firms
      SET status = 'active',
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, plan_tier, status, stripe_customer_id, stripe_subscription_id
    `,
    [firm.id]
  );

  return rows[0] || null;
}

async function markFirmInvoicePaymentFailed(invoice) {
  const subscriptionId =
    typeof invoice?.subscription === "string"
      ? invoice.subscription
      : invoice?.subscription?.id || null;

  const customerId =
    typeof invoice?.customer === "string"
      ? invoice.customer
      : invoice?.customer?.id || null;

  let firm = null;

  if (subscriptionId) {
    firm = await getFirmByStripeSubscriptionId(subscriptionId);
  }

  if (!firm && customerId) {
    firm = await getFirmByStripeCustomerId(customerId);
  }

  if (!firm) {
    console.warn(
      `No firm found for invoice.payment_failed. subscription=${subscriptionId}, customer=${customerId}`
    );
    return null;
  }

  const { rows } = await pool.query(
    `
      UPDATE firms
      SET status = 'past_due',
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, plan_tier, status, stripe_customer_id, stripe_subscription_id
    `,
    [firm.id]
  );

  return rows[0] || null;
}

export async function handleStripeWebhookEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      return await attachCheckoutSessionToFirm(event.data.object);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await syncSubscriptionToFirm(event.data.object);

    case "invoice.paid":
      return await markFirmInvoicePaid(event.data.object);

    case "invoice.payment_failed":
      return await markFirmInvoicePaymentFailed(event.data.object);

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
      return null;
  }
}

export default {
  createCheckoutSession,
  createBillingPortalSession,
  ensureStripeCustomerForFirm,
  constructStripeEvent,
  handleStripeWebhookEvent,
};
