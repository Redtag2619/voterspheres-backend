import {
  createCheckoutSession,
  createBillingPortalSession,
  constructStripeEvent,
  handleStripeWebhookEvent,
} from "../services/billing.service.js";

export async function getBillingConfig(req, res) {
  res.json({
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

    const session = await createCheckoutSession({
      firmId: firm_id,
      priceId,
      successUrl: `${process.env.FRONTEND_URL}/billing?success=1`,
      cancelUrl: `${process.env.FRONTEND_URL}/billing?canceled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createBillingPortalSessionController(req, res) {
  try {
    const { customerId } = req.body;

    const session = await createBillingPortalSession({
      customerId,
      returnUrl: `${process.env.FRONTEND_URL}/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function stripeWebhook(req, res) {
  try {
    const sig = req.headers["stripe-signature"];
    const event = constructStripeEvent(req.body, sig);

    await handleStripeWebhookEvent(event);

    res.json({ received: true });
  } catch (err) {
    res.status(400).send(err.message);
  }
}
