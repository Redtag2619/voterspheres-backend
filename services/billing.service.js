import Stripe from "stripe";
import { pool } from "../config/database.js";

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

  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return "enterprise";

  return "free";
}

function mapStripeStatusToFirmStatus(status) {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      return "inactive";
  }
}

export async function createCheckoutSession({
  firmId,
  priceId,
  successUrl,
  cancelUrl,
}) {
  const customer = await stripe.customers.create({
    metadata: { firm_id: String(firmId) },
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(firmId),
    metadata: {
      firm_id: String(firmId),
      plan_tier: mapPriceIdToPlanTier(priceId),
    },
    subscription_data: {
      metadata: {
        firm_id: String(firmId),
      },
    },
  });

  return session;
}

export async function createBillingPortalSession({ customerId, returnUrl }) {
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function attachCheckoutSessionToFirm(session) {
  const firmId =
    session.client_reference_id || session.metadata?.firm_id;

  if (!firmId) return null;

  const { rows } = await pool.query(
    `
    UPDATE firms
    SET stripe_customer_id = $1,
        stripe_subscription_id = $2,
        plan_tier = $3,
        status = 'active',
        updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `,
    [
      session.customer,
      session.subscription,
      normalizePlanTier(session.metadata?.plan_tier),
      firmId,
    ]
  );

  return rows[0] || null;
}

export async function syncSubscriptionToFirm(subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const { rows } = await pool.query(
    `
    UPDATE firms
    SET stripe_subscription_id = $1,
        plan_tier = $2,
        status = $3,
        updated_at = NOW()
    WHERE stripe_customer_id = $4
    RETURNING *
  `,
    [
      subscription.id,
      mapPriceIdToPlanTier(
        subscription.items.data[0]?.price?.id
      ),
      mapStripeStatusToFirmStatus(subscription.status),
      customerId,
    ]
  );

  return rows[0] || null;
}

export async function markInvoicePaid(invoice) {
  await pool.query(
    `
    UPDATE firms
    SET status = 'active',
        updated_at = NOW()
    WHERE stripe_customer_id = $1
  `,
    [invoice.customer]
  );
}

export async function markInvoiceFailed(invoice) {
  await pool.query(
    `
    UPDATE firms
    SET status = 'past_due',
        updated_at = NOW()
    WHERE stripe_customer_id = $1
  `,
    [invoice.customer]
  );
}

export function constructStripeEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

export async function handleStripeWebhookEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      return attachCheckoutSessionToFirm(event.data.object);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return syncSubscriptionToFirm(event.data.object);

    case "invoice.paid":
      return markInvoicePaid(event.data.object);

    case "invoice.payment_failed":
      return markInvoiceFailed(event.data.object);

    default:
      console.log("Unhandled event:", event.type);
  }
}
