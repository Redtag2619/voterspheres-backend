import {
  createCheckoutSession,
  createBillingPortalSession,
  constructStripeEvent,
  handleStripeWebhookEvent,
} from "../services/billing.service.js";
import { pool } from "../db/pool.js";

export async function getBillingConfig(req, res) {
  return res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER,
      pro: process.env.STRIPE_PRICE_PRO,
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
    },
  });
}

export async function createCheckoutSessionController(req, res) {
  try {
    const { firm_id, priceId } = req.body;

    if (!firm_id) {
      return res.status(400).json({ error: "firm_id is required" });
    }

    if (!priceId) {
      return res.status(400).json({ error: "priceId is required" });
    }

    const session = await createCheckoutSession({
      firmId: firm_id,
      priceId,
      successUrl: `${process.env.FRONTEND_URL}/billing?success=1`,
      cancelUrl: `${process.env.FRONTEND_URL}/billing?canceled=1`,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("createCheckoutSessionController error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export async function createBillingPortalSessionController(req, res) {
  try {
    const { firm_id } = req.body;

    if (!firm_id) {
      return res.status(400).json({ error: "firm_id is required" });
    }

    const result = await pool.query(
      `
        SELECT stripe_customer_id
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [firm_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Firm not found" });
    }

    const customerId = result.rows[0].stripe_customer_id;

    if (!customerId) {
      return res.status(400).json({ error: "No Stripe customer found for this firm" });
    }

    const session = await createBillingPortalSession({
      customerId,
      returnUrl: `${process.env.FRONTEND_URL}/billing`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("createBillingPortalSessionController error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export async function stripeWebhook(req, res) {
  try {
    const signature = req.headers["stripe-signature"];
    const event = constructStripeEvent(req.body, signature);

    await handleStripeWebhookEvent(event);

    return res.json({ received: true });
  } catch (err) {
    console.error("stripeWebhook error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
}
