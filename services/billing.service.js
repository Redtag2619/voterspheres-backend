import Stripe from "stripe";
import { pool } from "../db/pool.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================================
// CREATE CHECKOUT SESSION
// ================================
export async function createCheckoutSession({ firm_id, price_id }) {
  const firmRes = await pool.query(
    "SELECT * FROM firms WHERE id = $1",
    [firm_id]
  );

  if (firmRes.rows.length === 0) {
    throw new Error("Firm not found");
  }

  const firm = firmRes.rows[0];

  let customerId = firm.stripe_customer_id;

  // Create Stripe customer if missing
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: firm.email,
      metadata: {
        firm_id: firm.id,
      },
    });

    customerId = customer.id;

    await pool.query(
      "UPDATE firms SET stripe_customer_id = $1 WHERE id = $2",
      [customerId, firm.id]
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: price_id,
        quantity: 1,
      },
    ],
    success_url: `${process.env.FRONTEND_URL}/billing/success`,
    cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
  });

  return session;
}

// ================================
// HANDLE STRIPE WEBHOOKS
// ================================
export async function handleStripeWebhook(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      const customerId = session.customer;
      const subscriptionId = session.subscription;

      // attach subscription to firm
      await pool.query(
        `UPDATE firms 
         SET stripe_subscription_id = $1 
         WHERE stripe_customer_id = $2`,
        [subscriptionId, customerId]
      );

      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object;

      const customerId = subscription.customer;
      const status = subscription.status;

      let plan = "free";

      if (subscription.items.data.length > 0) {
        const priceId = subscription.items.data[0].price.id;

        // Map price → plan
        if (priceId === process.env.STRIPE_PRICE_PRO) {
          plan = "pro";
        } else if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) {
          plan = "enterprise";
        }
      }

      await pool.query(
        `UPDATE firms
         SET plan_tier = $1,
             subscription_status = $2
         WHERE stripe_customer_id = $3`,
        [plan, status, customerId]
      );

      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;

      await pool.query(
        `UPDATE firms
         SET plan_tier = 'free',
             subscription_status = 'canceled'
         WHERE stripe_customer_id = $1`,
        [subscription.customer]
      );

      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;

      await pool.query(
        `UPDATE firms
         SET subscription_status = 'past_due'
         WHERE stripe_customer_id = $1`,
        [invoice.customer]
      );

      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;

      await pool.query(
        `UPDATE firms
         SET subscription_status = 'active'
         WHERE stripe_customer_id = $1`,
        [invoice.customer]
      );

      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }
}
