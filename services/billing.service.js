import Stripe from "stripe";
import { pool } from "../db/pool.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function mapPriceIdToPlanTier(priceId) {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return "enterprise";
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  return "free";
}

export async function createCheckoutSession({ firmId, priceId, successUrl, cancelUrl }) {
  const firmRes = await pool.query(
    `
      SELECT *
      FROM firms
      WHERE id = $1
      LIMIT 1
    `,
    [firmId]
  );

  if (firmRes.rows.length === 0) {
    throw new Error("Firm not found");
  }

  const firm = firmRes.rows[0];
  let customerId = firm.stripe_customer_id || null;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: firm.email || undefined,
      name: firm.firm_name || firm.name || undefined,
      metadata: {
        firm_id: String(firm.id),
      },
    });

    customerId = customer.id;

    await pool.query(
      `
        UPDATE firms
        SET stripe_customer_id = $1,
            updated_at = NOW()
        WHERE id = $2
      `,
      [customerId, firm.id]
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(firm.id),
    metadata: {
      firm_id: String(firm.id),
      plan_tier: mapPriceIdToPlanTier(priceId),
    },
    subscription_data: {
      metadata: {
        firm_id: String(firm.id),
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

export function constructStripeEvent(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

async function attachCheckoutSessionToFirm(session) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const firmId = session.client_reference_id || session.metadata?.firm_id || null;

  if (firmId) {
    await pool.query(
      `
        UPDATE firms
        SET stripe_customer_id = COALESCE($1, stripe_customer_id),
            stripe_subscription_id = $2,
            updated_at = NOW()
        WHERE id = $3
      `,
      [customerId, subscriptionId, firmId]
    );
    return;
  }

  await pool.query(
    `
      UPDATE firms
      SET stripe_subscription_id = $1,
          updated_at = NOW()
      WHERE stripe_customer_id = $2
    `,
    [subscriptionId, customerId]
  );
}

async function syncSubscriptionToFirm(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const planTier = mapPriceIdToPlanTier(priceId);

  await pool.query(
    `
      UPDATE firms
      SET stripe_subscription_id = $1,
          plan_tier = $2,
          status = $3,
          updated_at = NOW()
      WHERE stripe_customer_id = $4
    `,
    [subscription.id, planTier, status, customerId]
  );
}

async function deleteSubscriptionFromFirm(subscription) {
  await pool.query(
    `
      UPDATE firms
      SET plan_tier = 'free',
          status = 'canceled',
          updated_at = NOW()
      WHERE stripe_customer_id = $1
    `,
    [subscription.customer]
  );
}

async function markInvoiceFailed(invoice) {
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

async function markInvoicePaid(invoice) {
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

export async function handleStripeWebhookEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      await attachCheckoutSessionToFirm(event.data.object);
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscriptionToFirm(event.data.object);
      break;

    case "customer.subscription.deleted":
      await deleteSubscriptionFromFirm(event.data.object);
      break;

    case "invoice.payment_failed":
      await markInvoiceFailed(event.data.object);
      break;

    case "invoice.paid":
      await markInvoicePaid(event.data.object);
      break;

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }
}

export default {
  createCheckoutSession,
  createBillingPortalSession,
  constructStripeEvent,
  handleStripeWebhookEvent,
};
