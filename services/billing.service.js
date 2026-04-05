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
    enterprise: getEnv("STRIPE_PRICE_ENTERPRISE")
  };
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
  await pool.query(`
    ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
      ADD COLUMN IF NOT EXISTS last_webhook_event_type TEXT,
      ADD COLUMN IF NOT EXISTS last_webhook_event_id TEXT,
      ADD COLUMN IF NOT EXISTS last_webhook_event_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);
}

export async function getBillingConfig() {
  const prices = getPriceMap();

  return {
    prices,
    has_stripe_key: Boolean(getEnv("STRIPE_SECRET_KEY")),
    billing_test_mode: isBillingTestMode(),
    app_base_url: getAppBaseUrl()
  };
}

export async function getBillingDebugForFirm(firmId) {
  await ensureBillingColumns();

  const result = await pool.query(
    `
      select
        id as firm_id,
        name as firm_name,
        plan_tier,
        status,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        last_webhook_event_type,
        last_webhook_event_id,
        last_webhook_event_at,
        updated_at
      from firms
      where id = $1
      limit 1
    `,
    [firmId]
  );

  return result.rows[0] || null;
}

async function createTestModeCheckoutSessionForFirm({ firmId, priceId }) {
  await ensureBillingColumns();

  if (!firmId) {
    throw new Error("Missing firm id");
  }

  const firmResult = await pool.query(
    `
      select id, name
      from firms
      where id = $1
      limit 1
    `,
    [firmId]
  );

  const firm = firmResult.rows[0];
  if (!firm) {
    throw new Error("Firm not found");
  }

  const planTier = inferPlanTierFromPriceId(priceId);

  await pool.query(
    `
      update firms
      set
        plan_tier = $2,
        status = 'active',
        stripe_price_id = $3,
        last_webhook_event_type = 'billing_test_mode_checkout',
        last_webhook_event_id = $4,
        last_webhook_event_at = now(),
        updated_at = now()
      where id = $1
    `,
    [firmId, planTier, priceId || `test_${planTier}`, `test_checkout_${Date.now()}`]
  );

  const baseUrl = getAppBaseUrl();

  return {
    id: `test_checkout_${Date.now()}`,
    url: `${baseUrl}/billing?checkout=success&test_mode=1&plan=${planTier}`,
    mode: "test"
  };
}

export async function createCheckoutSessionForFirm({
  firmId,
  email,
  priceId
}) {
  if (isBillingTestMode()) {
    return createTestModeCheckoutSessionForFirm({ firmId, priceId });
  }

  await ensureBillingColumns();

  if (!firmId) {
    throw new Error("Missing firm id");
  }

  if (!priceId) {
    throw new Error("Missing priceId");
  }

  const stripe = await getStripe();

  const firmResult = await pool.query(
    `
      select
        id,
        name,
        plan_tier,
        status,
        stripe_customer_id
      from firms
      where id = $1
      limit 1
    `,
    [firmId]
  );

  const firm = firmResult.rows[0];
  if (!firm) {
    throw new Error("Firm not found");
  }

  let customerId = firm.stripe_customer_id || null;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email || undefined,
      name: firm.name || `Firm ${firmId}`,
      metadata: {
        firm_id: String(firmId)
      }
    });

    customerId = customer.id;

    await pool.query(
      `
        update firms
        set
          stripe_customer_id = $2,
          updated_at = now()
        where id = $1
      `,
      [firmId, customerId]
    );
  }

  const baseUrl = getAppBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
    metadata: {
      firm_id: String(firmId),
      price_id: String(priceId)
    },
    allow_promotion_codes: true
  });

  await pool.query(
    `
      update firms
      set
        stripe_price_id = $2,
        updated_at = now()
      where id = $1
    `,
    [firmId, priceId]
  );

  return {
    id: session.id,
    url: session.url,
    mode: "stripe"
  };
}

export async function createPortalSessionForFirm({ firmId }) {
  if (isBillingTestMode()) {
    const firm = await getBillingDebugForFirm(firmId);

    if (!firm) {
      throw new Error("Firm not found");
    }

    return {
      url: `${getAppBaseUrl()}/billing?portal=success&test_mode=1&plan=${firm.plan_tier || "starter"}`
    };
  }

  await ensureBillingColumns();

  if (!firmId) {
    throw new Error("Missing firm id");
  }

  const stripe = await getStripe();

  const firmResult = await pool.query(
    `
      select stripe_customer_id
      from firms
      where id = $1
      limit 1
    `,
    [firmId]
  );

  const firm = firmResult.rows[0];
  if (!firm) {
    throw new Error("Firm not found");
  }

  if (!firm.stripe_customer_id) {
    throw new Error("No Stripe customer linked to this firm");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: firm.stripe_customer_id,
    return_url: `${getAppBaseUrl()}/billing`
  });

  return {
    url: session.url
  };
}

export async function handleStripeWebhook({ rawBody, signature }) {
  await ensureBillingColumns();

  const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  const stripe = await getStripe();
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  const eventType = event.type;
  const eventId = event.id;

  const writeWebhookAudit = async (firmId) => {
    if (!firmId) return;

    await pool.query(
      `
        update firms
        set
          last_webhook_event_type = $2,
          last_webhook_event_id = $3,
          last_webhook_event_at = now(),
          updated_at = now()
        where id = $1
      `,
      [firmId, eventType, eventId]
    );
  };

  if (eventType === "checkout.session.completed") {
    const session = event.data.object;
    const firmId = Number(session?.metadata?.firm_id || 0) || null;
    const customerId = session?.customer || null;
    const subscriptionId = session?.subscription || null;

    if (firmId) {
      await pool.query(
        `
          update firms
          set
            stripe_customer_id = coalesce($2, stripe_customer_id),
            stripe_subscription_id = coalesce($3, stripe_subscription_id),
            status = 'active',
            updated_at = now()
          where id = $1
        `,
        [firmId, customerId, subscriptionId]
      );
      await writeWebhookAudit(firmId);
    }
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const subscription = event.data.object;
    const customerId = subscription?.customer || null;
    const subscriptionId = subscription?.id || null;
    const priceId = subscription?.items?.data?.[0]?.price?.id || null;
    const status = subscription?.status || "active";

    let planTier = "starter";
    const prices = getPriceMap();
    if (priceId && priceId === prices.enterprise) planTier = "enterprise";
    else if (priceId && priceId === prices.pro) planTier = "pro";
    else if (priceId && priceId === prices.starter) planTier = "starter";

    const result = await pool.query(
      `
        update firms
        set
          stripe_subscription_id = $2,
          stripe_price_id = $3,
          stripe_customer_id = $4,
          plan_tier = $5,
          status = $6,
          last_webhook_event_type = $7,
          last_webhook_event_id = $8,
          last_webhook_event_at = now(),
          updated_at = now()
        where stripe_customer_id = $4
        returning id
      `,
      [null, subscriptionId, priceId, customerId, planTier, status, event.type, event.id]
    );

    const firmId = result.rows?.[0]?.id || null;
    if (firmId) {
      await writeWebhookAudit(firmId);
    }
  }

  if (
    event.type === "customer.subscription.deleted" ||
    event.type === "invoice.payment_failed"
  ) {
    const obj = event.data.object;
    const customerId = obj?.customer || null;

    const result = await pool.query(
      `
        update firms
        set
          status = 'past_due',
          last_webhook_event_type = $2,
          last_webhook_event_id = $3,
          last_webhook_event_at = now(),
          updated_at = now()
        where stripe_customer_id = $1
        returning id
      `,
      [customerId, event.type, event.id]
    );

    const firmId = result.rows?.[0]?.id || null;
    if (firmId) {
      await writeWebhookAudit(firmId);
    }
  }

  return { received: true };
}
