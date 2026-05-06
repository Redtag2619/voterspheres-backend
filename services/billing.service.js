import { pool } from "../db/pool.js"; 

let stripeClient = null;

function getEnv(name, fallback = "") {
  return process.env[name] || fallback; 
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isBillingTestMode() {
  return String(getEnv("BILLING_TEST_MODE", "false")).toLowerCase() === "true";
}

function getAppBaseUrl() {
  return (
    getEnv("FRONTEND_URL") ||
    getEnv("FRONTEND_APP_URL") ||
    getEnv("VERCEL_FRONTEND_URL") ||
    "https://www.voterspheres.org"
  ).replace(/\/$/, "");
}

function getPriceMap() {
  return {
    starter:
      getEnv("STRIPE_PRICE_ID_STARTER") ||
      getEnv("STRIPE_PRICE_STARTER") ||
      getEnv("STRIPE_STARTER_PRICE_ID"),
    pro:
      getEnv("STRIPE_PRICE_ID_PRO") ||
      getEnv("STRIPE_PRICE_PRO") ||
      getEnv("STRIPE_PRO_PRICE_ID"),
    enterprise:
      getEnv("STRIPE_PRICE_ID_ENTERPRISE") ||
      getEnv("STRIPE_PRICE_ENTERPRISE") ||
      getEnv("STRIPE_ENTERPRISE_PRICE_ID"),
  };
}

function normalizePlanTier(value) {
  const v = String(value || "").toLowerCase().trim();

  if (v === "enterprise" || v === "agency" || v === "premium") return "enterprise";
  if (v === "pro" || v === "professional") return "pro";
  if (v === "starter" || v === "basic" || v === "free") return "starter";

  return "starter";
}

function normalizeSubscriptionStatus(value) {
  const v = String(value || "").toLowerCase().trim();

  if (v === "trialing" || v === "active") return "active";
  if (v === "past_due" || v === "unpaid") return "past_due";
  if (v === "canceled" || v === "cancelled") return "canceled";
  if (v === "incomplete" || v === "incomplete_expired" || v === "paused") {
    return "inactive";
  }

  return v || "active";
}

function inferPlanTierFromPriceId(priceId) {
  const prices = getPriceMap();

  if (priceId && prices.enterprise && priceId === prices.enterprise) {
    return "enterprise";
  }

  if (priceId && prices.pro && priceId === prices.pro) {
    return "pro";
  }

  if (priceId && prices.starter && priceId === prices.starter) {
    return "starter";
  }

  const value = String(priceId || "").toLowerCase();

  if (value.includes("enterprise")) return "enterprise";
  if (value.includes("pro")) return "pro";
  if (value.includes("starter")) return "starter";

  return "starter";
}

function inferPlanTierFromMetadata(metadata = {}) {
  return normalizePlanTier(metadata?.plan || metadata?.plan_tier || metadata?.tier || "");
}

function getCurrentPeriodEnd(subscription = {}) {
  if (!subscription?.current_period_end) return null;
  return new Date(Number(subscription.current_period_end) * 1000);
}

async function getStripe() {
  if (stripeClient) return stripeClient;

  const secretKey = getEnv("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw createHttpError("Missing STRIPE_SECRET_KEY", 500);
  }

  const mod = await import("stripe");
  const Stripe = mod.default;
  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

async function ensureBillingColumns() {
  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'starter',
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'inactive',
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
      ADD COLUMN IF NOT EXISTS subscription_status TEXT,
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP,
      ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_webhook_event_type TEXT,
      ADD COLUMN IF NOT EXISTS last_webhook_event_id TEXT,
      ADD COLUMN IF NOT EXISTS last_webhook_event_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE firms
    SET
      plan_tier = COALESCE(NULLIF(plan_tier, ''), 'starter'),
      status = COALESCE(NULLIF(status, ''), 'inactive'),
      subscription_status = COALESCE(NULLIF(subscription_status, ''), status, 'inactive'),
      billing_updated_at = COALESCE(billing_updated_at, updated_at, NOW()),
      updated_at = COALESCE(updated_at, NOW())
  `);
}

async function findFirmById(firmId) {
  if (!firmId) return null;

  await ensureBillingColumns();

  const result = await pool.query(
    `
      SELECT
        id,
        name,
        slug,
        plan_tier,
        status,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        subscription_status,
        current_period_end,
        billing_updated_at,
        last_webhook_event_type,
        last_webhook_event_id,
        last_webhook_event_at,
        updated_at
      FROM firms
      WHERE id = $1
      LIMIT 1
    `,
    [firmId]
  );

  return result.rows[0] || null;
}

async function findFirmByCustomerId(customerId) {
  if (!customerId) return null;

  await ensureBillingColumns();

  const result = await pool.query(
    `
      SELECT id
      FROM firms
      WHERE stripe_customer_id = $1
      LIMIT 1
    `,
    [customerId]
  );

  return result.rows[0] || null;
}

async function updateFirmBillingPlan({
  firmId,
  planTier = "starter",
  status = "active",
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripePriceId = null,
  currentPeriodEnd = null,
  eventType = null,
  eventId = null,
}) {
  if (!firmId) return null;

  await ensureBillingColumns();

  const normalizedPlan = normalizePlanTier(planTier);
  const normalizedStatus = normalizeSubscriptionStatus(status);

  const result = await pool.query(
    `
      UPDATE firms
      SET
        plan_tier = $2,
        status = CASE
          WHEN $3 = 'canceled' THEN 'inactive'
          WHEN $3 = 'past_due' THEN 'past_due'
          WHEN $3 = 'inactive' THEN 'inactive'
          ELSE 'active'
        END,
        subscription_status = $3,
        stripe_customer_id = COALESCE($4, stripe_customer_id),
        stripe_subscription_id = COALESCE($5, stripe_subscription_id),
        stripe_price_id = COALESCE($6, stripe_price_id),
        current_period_end = COALESCE($7, current_period_end),
        last_webhook_event_type = COALESCE($8, last_webhook_event_type),
        last_webhook_event_id = COALESCE($9, last_webhook_event_id),
        last_webhook_event_at = CASE
          WHEN $8 IS NOT NULL THEN NOW()
          ELSE last_webhook_event_at
        END,
        billing_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      firmId,
      normalizedPlan,
      normalizedStatus,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      currentPeriodEnd,
      eventType,
      eventId,
    ]
  );

  return result.rows[0] || null;
}

async function upsertCustomerForFirm({ firmId, email }) {
  const stripe = await getStripe();
  const firm = await findFirmById(firmId);

  if (!firm) {
    throw createHttpError("Firm not found", 404);
  }

  if (firm.stripe_customer_id) {
    return firm.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    name: firm.name || `Firm ${firmId}`,
    metadata: {
      firm_id: String(firmId),
    },
  });

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_customer_id = $2,
        billing_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, customer.id]
  );

  return customer.id;
}

async function tryResolveFirmIdFromStripeCustomer(customerId) {
  if (!customerId) return null;

  const existing = await findFirmByCustomerId(customerId);
  if (existing?.id) {
    return existing.id;
  }

  try {
    const stripe = await getStripe();
    const customer = await stripe.customers.retrieve(customerId);

    const firmId = Number(customer?.metadata?.firm_id || 0) || null;
    if (!firmId) return null;

    await pool.query(
      `
        UPDATE firms
        SET
          stripe_customer_id = $2,
          billing_updated_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [firmId, customerId]
    );

    return firmId;
  } catch {
    return null;
  }
}

async function retrieveSubscription(subscriptionId) {
  if (!subscriptionId) return null;

  const stripe = await getStripe();

  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    return null;
  }
}

function extractPriceIdFromSubscription(subscription = {}) {
  return (
    subscription?.items?.data?.[0]?.price?.id ||
    subscription?.plan?.id ||
    null
  );
}

export async function getBillingConfig() {
  const prices = getPriceMap();

  return {
    ok: true,
    publishable_key: getEnv("STRIPE_PUBLISHABLE_KEY"),
    publishableKey: getEnv("STRIPE_PUBLISHABLE_KEY"),
    prices,
    priceIds: prices,
    starter: prices.starter,
    pro: prices.pro,
    enterprise: prices.enterprise,
    has_stripe_key: Boolean(getEnv("STRIPE_SECRET_KEY")),
    billing_test_mode: isBillingTestMode(),
    app_base_url: getAppBaseUrl(),
  };
}

export async function getBillingDebugForFirm(firmId) {
  await ensureBillingColumns();

  if (!firmId) {
    throw createHttpError("Missing firm id", 400);
  }

  const firm = await findFirmById(firmId);
  if (!firm) return null;

  return {
    firm_id: firm.id,
    firm_name: firm.name || null,
    email: null,
    plan_tier: normalizePlanTier(firm.plan_tier),
    status: firm.status || "inactive",
    subscription_status: firm.subscription_status || null,
    current_period_end: firm.current_period_end || null,
    billing_updated_at: firm.billing_updated_at || null,
    stripe_customer_id: firm.stripe_customer_id || null,
    stripe_subscription_id: firm.stripe_subscription_id || null,
    stripe_price_id: firm.stripe_price_id || null,
    last_webhook_event_type: firm.last_webhook_event_type || null,
    last_webhook_event_id: firm.last_webhook_event_id || null,
    last_webhook_event_at: firm.last_webhook_event_at || null,
    updated_at: firm.updated_at || null,
  };
}

async function createTestModeCheckoutSessionForFirm({
  firmId,
  priceId,
  plan = "",
  successUrl = "",
}) {
  await ensureBillingColumns();

  if (!firmId) {
    throw createHttpError("Missing firm id", 400);
  }

  const firm = await findFirmById(firmId);
  if (!firm) {
    throw createHttpError("Firm not found", 404);
  }

  const planTier = normalizePlanTier(plan || inferPlanTierFromPriceId(priceId));
  const eventId = `test_checkout_${Date.now()}`;

  await updateFirmBillingPlan({
    firmId,
    planTier,
    status: "active",
    stripePriceId: priceId || `test_${planTier}`,
    eventType: "billing_test_mode_checkout",
    eventId,
  });

  const baseUrl = getAppBaseUrl();

  return {
    id: eventId,
    url:
      successUrl ||
      `${baseUrl}/dashboard?checkout=success&test_mode=1&plan=${encodeURIComponent(planTier)}`,
    mode: "test",
  };
}

export async function createCheckoutSessionForFirm({
  firmId,
  email,
  priceId,
  plan = "",
  successUrl = "",
  cancelUrl = "",
}) {
  await ensureBillingColumns();

  const planTier = normalizePlanTier(plan || inferPlanTierFromPriceId(priceId));

  if (isBillingTestMode()) {
    return createTestModeCheckoutSessionForFirm({
      firmId,
      priceId,
      plan: planTier,
      successUrl,
    });
  }

  if (!firmId) {
    throw createHttpError("Missing firm id", 400);
  }

  if (!priceId) {
    throw createHttpError("Missing priceId", 400);
  }

  const firm = await findFirmById(firmId);
  if (!firm) {
    throw createHttpError("Firm not found", 404);
  }

  const stripe = await getStripe();
  const customerId = await upsertCustomerForFirm({ firmId, email });
  const baseUrl = getAppBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url:
      successUrl ||
      `${baseUrl}/dashboard?checkout=success&plan=${encodeURIComponent(planTier)}`,
    cancel_url:
      cancelUrl ||
      `${baseUrl}/pricing?checkout=cancelled&upgrade=${encodeURIComponent(planTier)}`,
    metadata: {
      firm_id: String(firmId),
      price_id: String(priceId),
      plan: planTier,
      plan_tier: planTier,
    },
    subscription_data: {
      metadata: {
        firm_id: String(firmId),
        price_id: String(priceId),
        plan: planTier,
        plan_tier: planTier,
      },
    },
    allow_promotion_codes: true,
  });

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_customer_id = COALESCE($2, stripe_customer_id),
        stripe_price_id = $3,
        billing_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, customerId, priceId]
  );

  return {
    id: session.id,
    url: session.url,
    checkout_url: session.url,
    mode: "stripe",
  };
}

export async function createPortalSessionForFirm({ firmId, returnUrl = "" }) {
  await ensureBillingColumns();

  if (isBillingTestMode()) {
    const firm = await getBillingDebugForFirm(firmId);

    if (!firm) {
      throw createHttpError("Firm not found", 404);
    }

    return {
      url: `${getAppBaseUrl()}/billing?portal=success&test_mode=1&plan=${firm.plan_tier || "starter"}`,
    };
  }

  if (!firmId) {
    throw createHttpError("Missing firm id", 400);
  }

  const firm = await findFirmById(firmId);
  if (!firm) {
    throw createHttpError("Firm not found", 404);
  }

  if (!firm.stripe_customer_id) {
    throw createHttpError("No Stripe customer linked to this firm", 400);
  }

  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: firm.stripe_customer_id,
    return_url: returnUrl || `${getAppBaseUrl()}/billing`,
  });

  return {
    url: session.url,
    portal_url: session.url,
  };
}

async function applyCheckoutCompleted(session, eventType, eventId) {
  const firmId = Number(session?.metadata?.firm_id || 0) || null;
  const customerId = session?.customer || null;
  const subscriptionId = session?.subscription || null;
  const metadataPriceId = session?.metadata?.price_id || null;
  const metadataPlan = inferPlanTierFromMetadata(session?.metadata || {});

  if (!firmId && !customerId) return null;

  let resolvedFirmId = firmId;

  if (!resolvedFirmId && customerId) {
    resolvedFirmId = await tryResolveFirmIdFromStripeCustomer(customerId);
  }

  if (!resolvedFirmId) return null;

  let subscription = null;
  let priceId = metadataPriceId;
  let planTier = metadataPlan;

  if (subscriptionId) {
    subscription = await retrieveSubscription(subscriptionId);
    const subscriptionPriceId = extractPriceIdFromSubscription(subscription);
    priceId = subscriptionPriceId || priceId;
    planTier = inferPlanTierFromMetadata(subscription?.metadata || {}) || planTier;
  }

  if (!planTier || planTier === "starter") {
    planTier = inferPlanTierFromPriceId(priceId);
  }

  const status = subscription?.status || "active";
  const currentPeriodEnd = getCurrentPeriodEnd(subscription);

  return updateFirmBillingPlan({
    firmId: resolvedFirmId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
    planTier,
    status,
    currentPeriodEnd,
    eventType,
    eventId,
  });
}

async function applySubscriptionUpdated(subscription, eventType, eventId) {
  const customerId = subscription?.customer || null;
  const subscriptionId = subscription?.id || null;
  const priceId = extractPriceIdFromSubscription(subscription);
  const metadataPlan = inferPlanTierFromMetadata(subscription?.metadata || {});
  const planTier = metadataPlan || inferPlanTierFromPriceId(priceId);
  const normalizedStatus = normalizeSubscriptionStatus(subscription?.status || "active");
  const currentPeriodEnd = getCurrentPeriodEnd(subscription);

  let firmId = Number(subscription?.metadata?.firm_id || 0) || null;

  if (!firmId) {
    const firm = await findFirmByCustomerId(customerId);

    if (firm?.id) {
      firmId = firm.id;
    } else {
      firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
    }
  }

  if (!firmId) return null;

  if (normalizedStatus === "canceled") {
    return updateFirmBillingPlan({
      firmId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      planTier: "starter",
      status: "canceled",
      currentPeriodEnd,
      eventType,
      eventId,
    });
  }

  return updateFirmBillingPlan({
    firmId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
    planTier,
    status: normalizedStatus,
    currentPeriodEnd,
    eventType,
    eventId,
  });
}

async function applySubscriptionDeleted(subscription, eventType, eventId) {
  const customerId = subscription?.customer || null;

  let firmId = Number(subscription?.metadata?.firm_id || 0) || null;

  if (!firmId) {
    const firm = await findFirmByCustomerId(customerId);

    if (firm?.id) {
      firmId = firm.id;
    } else {
      firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
    }
  }

  if (!firmId) return null;

  return updateFirmBillingPlan({
    firmId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    stripePriceId: null,
    planTier: "starter",
    status: "canceled",
    eventType,
    eventId,
  });
}

async function applyInvoicePaymentFailed(invoice, eventType, eventId) {
  const customerId = invoice?.customer || null;

  let firmId = null;
  const firm = await findFirmByCustomerId(customerId);

  if (firm?.id) {
    firmId = firm.id;
  } else {
    firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
  }

  if (!firmId) return null;

  const existing = await findFirmById(firmId);

  return updateFirmBillingPlan({
    firmId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: existing?.stripe_subscription_id || null,
    stripePriceId: existing?.stripe_price_id || null,
    planTier: existing?.plan_tier || "starter",
    status: "past_due",
    eventType,
    eventId,
  });
}

async function applyInvoicePaid(invoice, eventType, eventId) {
  const customerId = invoice?.customer || null;
  const subscriptionId = invoice?.subscription || null;
  const invoicePriceId = invoice?.lines?.data?.[0]?.price?.id || null;

  let firmId = null;
  const firm = await findFirmByCustomerId(customerId);

  if (firm?.id) {
    firmId = firm.id;
  } else {
    firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
  }

  if (!firmId) return null;

  let priceId = invoicePriceId;
  let planTier = inferPlanTierFromPriceId(priceId);
  let subscription = null;
  let currentPeriodEnd = null;

  if (subscriptionId) {
    subscription = await retrieveSubscription(subscriptionId);
    priceId = extractPriceIdFromSubscription(subscription) || priceId;
    planTier =
      inferPlanTierFromMetadata(subscription?.metadata || {}) ||
      inferPlanTierFromPriceId(priceId);
    currentPeriodEnd = getCurrentPeriodEnd(subscription);
  }

  return updateFirmBillingPlan({
    firmId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
    planTier,
    status: "active",
    currentPeriodEnd,
    eventType,
    eventId,
  });
}

export async function handleStripeWebhook({ rawBody, signature }) {
  await ensureBillingColumns();

  const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    throw createHttpError("Missing STRIPE_WEBHOOK_SECRET", 500);
  }

  if (!signature) {
    throw createHttpError("Missing stripe-signature header", 400);
  }

  const stripe = await getStripe();
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  const eventType = event.type;
  const eventId = event.id;
  const obj = event.data.object;

  let firm = null;

  switch (eventType) {
    case "checkout.session.completed":
      firm = await applyCheckoutCompleted(obj, eventType, eventId);
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      firm = await applySubscriptionUpdated(obj, eventType, eventId);
      break;

    case "customer.subscription.deleted":
      firm = await applySubscriptionDeleted(obj, eventType, eventId);
      break;

    case "invoice.payment_failed":
      firm = await applyInvoicePaymentFailed(obj, eventType, eventId);
      break;

    case "invoice.paid":
    case "invoice.payment_succeeded":
      firm = await applyInvoicePaid(obj, eventType, eventId);
      break;

    default:
      break;
  }

  return {
    received: true,
    eventType,
    eventId,
    firm_id: firm?.id || null,
    plan_tier: firm?.plan_tier || null,
    status: firm?.status || null,
    subscription_status: firm?.subscription_status || null,
  };
}

export default {
  getBillingConfig,
  getBillingDebugForFirm,
  createCheckoutSessionForFirm,
  createPortalSessionForFirm,
  handleStripeWebhook,
};
