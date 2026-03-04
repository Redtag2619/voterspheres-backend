import express from "express";
import Stripe from "stripe";
import pool from "../db.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* --------------------------------
   CREATE CHECKOUT SESSION
-------------------------------- */

router.post("/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    let priceId;

    if (plan === "pro") {
      priceId = process.env.STRIPE_PRO_PRICE_ID;
    } else if (plan === "agency") {
      priceId = process.env.STRIPE_AGENCY_PRICE_ID;
    } else {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?canceled=true`,
      metadata: {
        organizationId: req.user.organizationId,
        plan
      }
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Checkout session failed" });
  }
});

/* --------------------------------
   STRIPE WEBHOOK
-------------------------------- */

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const organizationId = session.metadata.organizationId;
    const plan = session.metadata.plan;

    await pool.query(
      `UPDATE organizations
       SET subscription_plan = $1
       WHERE id = $2`,
      [plan, organizationId]
    );

    console.log(`Organization upgraded to ${plan}`);
  }

  res.json({ received: true });
});

export default router;
