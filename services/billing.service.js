import { pool } from "../db/pool.js";

let stripeClient = null;

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function isBillingTestMode() {
  return String(getEnv("BILLING_TEST_MODE", "false")).toLowerCase() === "true";
}

function getAppBaseUrl() {
  return (
    getEnv("FRONTEND_URL") ||
    getEnv("VERCEL_FRONTEND_URL") ||
    "https://www.voterspheres.org"
  );
}

function getPriceMap() {
  return {
    starter: getEnv("STRIPE_PRICE_STARTER"),
    pro: getEnv("STRIPE_PRICE_PRO"),
    enterprise: getEnv("STRIPE_PRICE_ENTERPRISE"),
  };
}

function normalizePlanTier(value) {
  const v = String(value || "").toLowerCase().trim();

  if (v === "enterprise") return "enterprise";
  if (v === "pro") return "pro";
  if (v === "starter") return "starter";
  if (v === "free") return "starter";

  return "starter";
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

async function getStripe() {
  if (stripeClient) return stripeClient;

  const secretKey = getEnv("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const mod = await import("stripe");
  const Stripe = mod.default;
  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

async function ensureBillingColumns() {
  async function ensureBillingColumns() {
  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'starter',
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'inactive',
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
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
      updated_at = COALESCE(updated_at, NOW())
  `);
}
async function findFirmById(firmId) {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        firm_name,
        email,
        plan_tier,
        status,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
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

async function writeWebhookAudit(firmId, eventType, eventId) {
  if (!firmId) return;

  await pool.query(
    `
      UPDATE firms
      SET
        last_webhook_event_type = $2,
        last_webhook_event_id = $3,
        last_webhook_event_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, eventType, eventId]
  );
}

async function upsertCustomerForFirm({ firmId, email }) {
  const stripe = await getStripe();
  const firm = await findFirmById(firmId);

  if (!firm) {
    throw new Error("Firm not found");
  }

  if (firm.stripe_customer_id) {
    return firm.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: email || firm.email || undefined,
    name: firm.firm_name || firm.name || `Firm ${firmId}`,
    metadata: {
      firm_id: String(firmId),
    },
  });

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_customer_id = $2,
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

export async function getBillingConfig() {
  const prices = getPriceMap();

  return {
    publishable_key: getEnv("STRIPE_PUBLISHABLE_KEY"),
    prices,
    has_stripe_key: Boolean(getEnv("STRIPE_SECRET_KEY")),
    billing_test_mode: isBillingTestMode(),
    app_base_url: getAppBaseUrl(),
  };
}

export async function getBillingDebugForFirm(firmId) {
  await ensureBillingColumns();

  const firm = await findFirmById(firmId);
  if (!firm) return null;

  return {
    firm_id: firm.id,
    firm_name: firm.firm_name || firm.name || null,
    email: firm.email || null,
    plan_tier: normalizePlanTier(firm.plan_tier),
    status: firm.status || "inactive",
    stripe_customer_id: firm.stripe_customer_id || null,
    stripe_subscription_id: firm.stripe_subscription_id || null,
    stripe_price_id: firm.stripe_price_id || null,
    last_webhook_event_type: firm.last_webhook_event_type || null,
    last_webhook_event_id: firm.last_webhook_event_id || null,
    last_webhook_event_at: firm.last_webhook_event_at || null,
    updated_at: firm.updated_at || null,
  };
}

async function createTestModeCheckoutSessionForFirm({ firmId, priceId }) {
  await ensureBillingColumns();

  if (!firmId) {
    throw new Error("Missing firm id");
  }

  const firm = await findFirmById(firmId);
  if (!firm) {
    throw new Error("Firm not found");
  }

  const planTier = inferPlanTierFromPriceId(priceId);

  await pool.query(
    `
      UPDATE firms
      SET
        plan_tier = $2,
        status = 'active',
        stripe_price_id = $3,
        last_webhook_event_type = 'billing_test_mode_checkout',
        last_webhook_event_id = $4,
        last_webhook_event_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, planTier, priceId || `test_${planTier}`, `test_checkout_${Date.now()}`]
  );

  const baseUrl = getAppBaseUrl();

  return {
    id: `test_checkout_${Date.now()}`,
    url: `${baseUrl}/billing?checkout=success&test_mode=1&plan=${planTier}`,
    mode: "test",
  };
}

export async function createCheckoutSessionForFirm({ firmId, email, priceId }) {
  await ensureBillingColumns();

  if (isBillingTestMode()) {
    return createTestModeCheckoutSessionForFirm({ firmId, priceId });
  }

  if (!firmId) {
    throw new Error("Missing firm id");
  }

  if (!priceId) {
    throw new Error("Missing priceId");
  }

  const firm = await findFirmById(firmId);
  if (!firm) {
    throw new Error("Firm not found");
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
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
    metadata: {
      firm_id: String(firmId),
      price_id: String(priceId),
    },
    allow_promotion_codes: true,
  });

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_price_id = $2,
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, priceId]
  );

  return {
    id: session.id,
    url: session.url,
    mode: "stripe",
  };
}

export async function createPortalSessionForFirm({ firmId }) {
  await ensureBillingColumns();

  if (isBillingTestMode()) {
    const firm = await getBillingDebugForFirm(firmId);

    if (!firm) {
      throw new Error("Firm not found");
    }

    return {
      url: `${getAppBaseUrl()}/billing?portal=success&test_mode=1&plan=${firm.plan_tier || "starter"}`,
    };
  }

  if (!firmId) {
    throw new Error("Missing firm id");
  }

  const firm = await findFirmById(firmId);
  if (!firm) {
    throw new Error("Firm not found");
  }

  if (!firm.stripe_customer_id) {
    throw new Error("No Stripe customer linked to this firm");
  }

  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: firm.stripe_customer_id,
    return_url: `${getAppBaseUrl()}/billing`,
  });

  return {
    url: session.url,
  };
}

async function applyCheckoutCompleted(session, eventType, eventId) {
  const firmId = Number(session?.metadata?.firm_id || 0) || null;
  const customerId = session?.customer || null;
  const subscriptionId = session?.subscription || null;
  const priceId = session?.metadata?.price_id || null;
  const planTier = inferPlanTierFromPriceId(priceId);

  if (!firmId) return;

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_customer_id = COALESCE($2, stripe_customer_id),
        stripe_subscription_id = COALESCE($3, stripe_subscription_id),
        stripe_price_id = COALESCE($4, stripe_price_id),
        plan_tier = $5,
        status = 'active',
        last_webhook_event_type = $6,
        last_webhook_event_id = $7,
        last_webhook_event_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, customerId, subscriptionId, priceId, planTier, eventType, eventId]
  );
}

async function applySubscriptionUpdated(subscription, eventType, eventId) {
  const customerId = subscription?.customer || null;
  const subscriptionId = subscription?.id || null;
  const priceId = subscription?.items?.data?.[0]?.price?.id || null;
  const rawStatus = String(subscription?.status || "active").toLowerCase();
  const planTier = inferPlanTierFromPriceId(priceId);

  const statusMap = {
    trialing: "active",
    active: "active",
    past_due: "past_due",
    unpaid: "past_due",
    canceled: "canceled",
    incomplete: "inactive",
    incomplete_expired: "inactive",
    paused: "inactive",
  };

  const normalizedStatus = statusMap[rawStatus] || "active";

  let firmId = null;
  const firm = await findFirmByCustomerId(customerId);

  if (firm?.id) {
    firmId = firm.id;
  } else {
    firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
  }

  if (!firmId) return;

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_customer_id = $2,
        stripe_subscription_id = $3,
        stripe_price_id = $4,
        plan_tier = $5,
        status = $6,
        last_webhook_event_type = $7,
        last_webhook_event_id = $8,
        last_webhook_event_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      firmId,
      customerId,
      subscriptionId,
      priceId,
      planTier,
      normalizedStatus,
      eventType,
      eventId,
    ]
  );
}

async function applySubscriptionDeleted(subscription, eventType, eventId) {
  const customerId = subscription?.customer || null;

  let firmId = null;
  const firm = await findFirmByCustomerId(customerId);

  if (firm?.id) {
    firmId = firm.id;
  } else {
    firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
  }

  if (!firmId) return;

  await pool.query(
    `
      UPDATE firms
      SET
        stripe_subscription_id = NULL,
        plan_tier = 'starter',
        status = 'canceled',
        last_webhook_event_type = $2,
        last_webhook_event_id = $3,
        last_webhook_event_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, eventType, eventId]
  );
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

  if (!firmId) return;

  await pool.query(
    `
      UPDATE firms
      SET
        status = 'past_due',
        last_webhook_event_type = $2,
        last_webhook_event_id = $3,
        last_webhook_event_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [firmId, eventType, eventId]
  );
}

async function applyInvoicePaid(invoice, eventType, eventId) {
  const customerId = invoice?.customer || null;
  const subscriptionId = invoice?.subscription || null;
  const priceId = invoice?.lines?.data?.[0]?.price?.id || null;

  let firmId = null;
  const firm = await findFirmByCustomerId(customerId);

  if (firm?.id) {
    firmId = firm.id;
  } else {
    firmId = await tryResolveFirmIdFromStripeCustomer(customerId);
  }

  if (!firmId) return;

  const updates = [];
  const values = [firmId];
  let idx = 2;

  updates.push(`status = 'active'`);
  updates.push(`last_webhook_event_type = $${idx++}`);
  values.push(eventType);
  updates.push(`last_webhook_event_id = $${idx++}`);
  values.push(eventId);
  updates.push(`last_webhook_event_at = NOW()`);
  updates.push(`updated_at = NOW()`);

  if (subscriptionId) {
    updates.push(`stripe_subscription_id = $${idx++}`);
    values.push(subscriptionId);
  }

  if (priceId) {
    updates.push(`stripe_price_id = $${idx++}`);
    values.push(priceId);
    updates.push(`plan_tier = $${idx++}`);
    values.push(inferPlanTierFromPriceId(priceId));
  }

  await pool.query(
    `
      UPDATE firms
      SET ${updates.join(", ")}
      WHERE id = $1
    `,
    values
  );
}

export async function handleStripeWebhook({ rawBody, signature }) {
  await ensureBillingColumns();

  const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  if (!signature) {
    throw new Error("Missing stripe-signature header");
  }

  const stripe = await getStripe();
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  const eventType = event.type;
  const eventId = event.id;
  const obj = event.data.object;

  switch (eventType) {
    case "checkout.session.completed":
      await applyCheckoutCompleted(obj, eventType, eventId);
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await applySubscriptionUpdated(obj, eventType, eventId);
      break;

    case "customer.subscription.deleted":
      await applySubscriptionDeleted(obj, eventType, eventId);
      break;

    case "invoice.payment_failed":
      await applyInvoicePaymentFailed(obj, eventType, eventId);
      break;

    case "invoice.paid":
      await applyInvoicePaid(obj, eventType, eventId);
      break;

    default:
      break;
  }

  return { received: true, eventType, eventId };
}
