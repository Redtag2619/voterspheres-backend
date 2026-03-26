import Stripe from "stripe";
import { pool } from "../db/pool.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function mapPlanTierFromPrice(priceId, priceLookupKey, productId) {
  const value = String(priceLookupKey || priceId || productId || "").toLowerCase();

  if (value.includes("enterprise")) return "enterprise";
  if (value.includes("pro")) return "pro";
  if (value.includes("trial")) return "trial";

  return "pro";
}

function toTimestampOrNull(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}

async function ensureBillingColumns() {
  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS billing_provider TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMP NULL;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);
}

async function findFirmIdFromSubscription(subscription) {
  const metadataFirmId = Number(subscription?.metadata?.firm_id || 0);
  if (metadataFirmId) return metadataFirmId;

  if (subscription?.customer) {
    const result = await pool.query(
      `
      SELECT id
      FROM firms
      WHERE stripe_customer_id = $1
      LIMIT 1
      `,
      [String(subscription.customer)]
    );
    if (result.rows[0]?.id) return result.rows[0].id;
  }

  if (subscription?.id) {
    const result = await pool.query(
      `
      SELECT id
      FROM firms
      WHERE stripe_subscription_id = $1
      LIMIT 1
      `,
      [String(subscription.id)]
    );
    if (result.rows[0]?.id) return result.rows[0].id;
  }

  return null;
}

async function syncFirmFromSubscription(subscription) {
  await ensureBillingColumns();

  const firmId = await findFirmIdFromSubscription(subscription);
  if (!firmId) {
    return { ok: false, reason: "firm_not_found" };
  }

  const item = subscription?.items?.data?.[0] || null;
  const price = item?.price || null;

  const priceId = price?.id || null;
  const productId =
    typeof price?.product === "string" ? price.product : price?.product?.id || null;
  const priceLookupKey = price?.lookup_key || null;

  const planTier = mapPlanTierFromPrice(priceId, priceLookupKey, productId);
  const subscriptionStatus = subscription?.status || "unknown";
  const currentPeriodEnd = toTimestampOrNull(subscription?.current_period_end);

  await pool.query(
    `
    UPDATE firms
    SET
      billing_provider = 'stripe',
      stripe_customer_id = $2,
      stripe_subscription_id = $3,
      stripe_price_id = $4,
      stripe_product_id = $5,
      stripe_subscription_status = $6,
      stripe_current_period_end = $7,
      plan_tier = $8,
      status = CASE
        WHEN $6 IN ('active', 'trialing', 'past_due') THEN 'active'
        WHEN $6 IN ('canceled', 'unpaid', 'incomplete_expired') THEN 'inactive'
        ELSE status
      END,
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      firmId,
      subscription?.customer ? String(subscription.customer) : null,
      subscription?.id ? String(subscription.id) : null,
      priceId,
      productId,
      subscriptionStatus,
      currentPeriodEnd,
      planTier
    ]
  );

  return {
    ok: true,
    firm_id: firmId,
    plan_tier: planTier,
    stripe_subscription_status: subscriptionStatus
  };
}

async function syncFirmFromCheckoutSession(session) {
  await ensureBillingColumns();

  const firmId =
    Number(session?.metadata?.firm_id || 0) ||
    Number(session?.subscription_details?.metadata?.firm_id || 0);

  if (!firmId) {
    return { ok: false, reason: "firm_not_found" };
  }

  await pool.query(
    `
    UPDATE firms
    SET
      billing_provider = 'stripe',
      stripe_customer_id = $2,
      stripe_subscription_id = $3,
      stripe_checkout_session_id = $4,
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      firmId,
      session?.customer ? String(session.customer) : null,
      session?.subscription ? String(session.subscription) : null,
      session?.id ? String(session.id) : null
    ]
  );

  return {
    ok: true,
    firm_id: firmId
  };
}

export async function createCheckoutSession(req, res, next) {
  try {
    await ensureBillingColumns();

    const {
      firm_id,
      price_id,
      success_url,
      cancel_url,
      customer_email
    } = req.body || {};

    if (!firm_id || !price_id || !success_url || !cancel_url) {
      return res.status(400).json({
        error: "firm_id, price_id, success_url, and cancel_url are required"
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: price_id,
          quantity: 1
        }
      ],
      success_url,
      cancel_url,
      customer_email: customer_email || undefined,
      metadata: {
        firm_id: String(firm_id)
      },
      subscription_data: {
        metadata: {
          firm_id: String(firm_id)
        }
      }
    });

    res.status(201).json({
      id: session.id,
      url: session.url
    });
  } catch (err) {
    next(err);
  }
}

export async function handleStripeWebhook(req, res, next) {
  try {
    await ensureBillingColumns();

    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        await syncFirmFromCheckoutSession(event.data.object);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        if (!subscription.items?.data?.length) {
          const hydrated = await stripe.subscriptions.retrieve(subscription.id, {
            expand: ["items.data.price"]
          });
          await syncFirmFromSubscription(hydrated);
        } else {
          await syncFirmFromSubscription(subscription);
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}
