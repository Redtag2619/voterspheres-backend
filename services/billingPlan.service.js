import Stripe from "stripe";
import pool from "../config/database.js";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizePlan(plan = "starter") {
  const value = text(plan).toLowerCase();

  if (["enterprise", "agency", "premium"].includes(value)) return "enterprise";
  if (["pro", "professional"].includes(value)) return "pro";
  if (["starter", "basic"].includes(value)) return "starter";

  return "starter";
}

function normalizeStatus(status = "active") {
  const value = text(status).toLowerCase();

  if (["active", "trialing"].includes(value)) return "active";
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(value)) return "past_due";
  if (["canceled", "cancelled"].includes(value)) return "canceled";

  return value || "active";
}

export function getBillingPriceMap() {
  return {
    starter:
      process.env.STRIPE_PRICE_ID_STARTER ||
      process.env.STRIPE_PRICE_STARTER ||
      process.env.STRIPE_STARTER_PRICE_ID ||
      "",
    pro:
      process.env.STRIPE_PRICE_ID_PRO ||
      process.env.STRIPE_PRICE_PRO ||
      process.env.STRIPE_PRO_PRICE_ID ||
      "",
    enterprise:
      process.env.STRIPE_PRICE_ID_ENTERPRISE ||
      process.env.STRIPE_PRICE_ENTERPRISE ||
      process.env.STRIPE_ENTERPRISE_PRICE_ID ||
      ""
  };
}

export function getPlanFromPriceId(priceId = "") {
  const cleanPriceId = text(priceId);
  const prices = getBillingPriceMap();

  if (!cleanPriceId) return "starter";
  if (cleanPriceId === prices.enterprise) return "enterprise";
  if (cleanPriceId === prices.pro) return "pro";
  if (cleanPriceId === prices.starter) return "starter";

  return "starter";
}

export function getPlanFromCheckoutSession(session = {}) {
  const metadataPlan =
    session?.metadata?.plan ||
    session?.metadata?.plan_tier ||
    session?.subscription_data?.metadata?.plan ||
    "";

  if (metadataPlan) return normalizePlan(metadataPlan);

  return "starter";
}

export async function getPlanFromSubscription(subscription = {}) {
  const metadataPlan =
    subscription?.metadata?.plan ||
    subscription?.metadata?.plan_tier ||
    "";

  if (metadataPlan) return normalizePlan(metadataPlan);

  const priceId =
    subscription?.items?.data?.[0]?.price?.id ||
    subscription?.plan?.id ||
    "";

  return getPlanFromPriceId(priceId);
}

export async function ensureBillingColumns() {
  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'starter'
  `);

  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
  `);

  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT
  `);

  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT
  `);

  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS subscription_status TEXT
  `);

  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMP
  `);
}

export async function getFirmById(firmId) {
  await ensureBillingColumns();

  const result = await pool.query(
    `
      SELECT *
      FROM firms
      WHERE id = $1
      LIMIT 1
    `,
    [firmId]
  );

  return result.rows?.[0] || null;
}

export async function getFirmByStripeCustomer(customerId) {
  await ensureBillingColumns();

  const result = await pool.query(
    `
      SELECT *
      FROM firms
      WHERE stripe_customer_id = $1
      LIMIT 1
    `,
    [customerId]
  );

  return result.rows?.[0] || null;
}

export async function updateFirmBillingPlan({
  firmId,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  planTier = "starter",
  subscriptionStatus = "active",
  currentPeriodEnd = null
}) {
  await ensureBillingColumns();

  const normalizedPlan = normalizePlan(planTier);
  const normalizedStatus = normalizeStatus(subscriptionStatus);

  const result = await pool.query(
    `
      UPDATE firms
      SET
        plan_tier = $2,
        status = CASE
          WHEN $3 = 'canceled' THEN 'inactive'
          ELSE COALESCE(status, 'active')
        END,
        stripe_customer_id = COALESCE($4, stripe_customer_id),
        stripe_subscription_id = COALESCE($5, stripe_subscription_id),
        subscription_status = $3,
        current_period_end = COALESCE($6, current_period_end),
        billing_updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      firmId,
      normalizedPlan,
      normalizedStatus,
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodEnd
    ]
  );

  return result.rows?.[0] || null;
}

export async function downgradeFirmToStarter({ firmId, stripeCustomerId = null }) {
  await ensureBillingColumns();

  const result = await pool.query(
    `
      UPDATE firms
      SET
        plan_tier = 'starter',
        subscription_status = 'canceled',
        stripe_customer_id = COALESCE($2, stripe_customer_id),
        billing_updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [firmId, stripeCustomerId]
  );

  return result.rows?.[0] || null;
}

export async function ensureStripeCustomerForFirm({ firm, user }) {
  if (!stripe) throw new Error("Missing STRIPE_SECRET_KEY");
  if (!firm?.id) throw new Error("Missing firm");

  if (firm.stripe_customer_id) {
    return firm.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: user?.email || undefined,
    name: firm?.name || user?.email || `Firm ${firm.id}`,
    metadata: {
      firm_id: String(firm.id),
      user_id: user?.id ? String(user.id) : ""
    }
  });

  await pool.query(
    `
      UPDATE firms
      SET stripe_customer_id = $2, billing_updated_at = NOW()
      WHERE id = $1
    `,
    [firm.id, customer.id]
  );

  return customer.id;
}

export async function syncFirmFromCheckoutSession(session = {}) {
  await ensureBillingColumns();

  const firmId = Number(session?.metadata?.firm_id || 0);
  const customerId = text(session?.customer || "");
  const subscriptionId = text(session?.subscription || "");

  if (!firmId && !customerId) {
    throw new Error("Checkout session missing firm/customer context");
  }

  let firm = firmId ? await getFirmById(firmId) : null;

  if (!firm && customerId) {
    firm = await getFirmByStripeCustomer(customerId);
  }

  if (!firm) {
    throw new Error("Unable to resolve firm for checkout session");
  }

  let planTier = getPlanFromCheckoutSession(session);
  let subscriptionStatus = "active";
  let currentPeriodEnd = null;

  if (stripe && subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    planTier = await getPlanFromSubscription(subscription);
    subscriptionStatus = subscription.status || "active";

    if (subscription.current_period_end) {
      currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    }
  }

  return updateFirmBillingPlan({
    firmId: firm.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planTier,
    subscriptionStatus,
    currentPeriodEnd
  });
}

export async function syncFirmFromSubscription(subscription = {}) {
  await ensureBillingColumns();

  const customerId = text(subscription?.customer || "");
  const subscriptionId = text(subscription?.id || "");
  const metadataFirmId = Number(subscription?.metadata?.firm_id || 0);

  let firm = metadataFirmId ? await getFirmById(metadataFirmId) : null;

  if (!firm && customerId) {
    firm = await getFirmByStripeCustomer(customerId);
  }

  if (!firm) {
    throw new Error("Unable to resolve firm for subscription");
  }

  const planTier = await getPlanFromSubscription(subscription);
  const subscriptionStatus = subscription.status || "active";
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  if (["canceled", "cancelled"].includes(normalizeStatus(subscriptionStatus))) {
    return downgradeFirmToStarter({
      firmId: firm.id,
      stripeCustomerId: customerId
    });
  }

  return updateFirmBillingPlan({
    firmId: firm.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planTier,
    subscriptionStatus,
    currentPeriodEnd
  });
}

export async function handleStripeBillingEvent(event = {}) {
  const type = event?.type || "";
  const object = event?.data?.object || {};

  if (type === "checkout.session.completed") {
    return syncFirmFromCheckoutSession(object);
  }

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    return syncFirmFromSubscription(object);
  }

  if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    const subscriptionId = object?.subscription;

    if (stripe && subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return syncFirmFromSubscription(subscription);
    }
  }

  if (type === "invoice.payment_failed") {
    const customerId = text(object?.customer || "");
    const firm = customerId ? await getFirmByStripeCustomer(customerId) : null;

    if (firm) {
      return updateFirmBillingPlan({
        firmId: firm.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: firm.stripe_subscription_id,
        planTier: firm.plan_tier || "starter",
        subscriptionStatus: "past_due"
      });
    }
  }

  return null;
}

export default {
  stripe,
  getBillingPriceMap,
  getPlanFromPriceId,
  ensureBillingColumns,
  getFirmById,
  updateFirmBillingPlan,
  ensureStripeCustomerForFirm,
  handleStripeBillingEvent,
  syncFirmFromCheckoutSession,
  syncFirmFromSubscription
};
