import Stripe from "stripe";
import { pool } from "../db/pool.js";

function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(secret);
}

async function ensureBillingColumns() {
  await pool.query(`
    ALTER TABLE firms
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms
    ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;
  `);

  await pool.query(`
    ALTER TABLE firms
    ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'trial';
  `);

  await pool.query(`
    ALTER TABLE firms
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);
}

async function getFirmForUser(user) {
  if (!user?.firm_id) {
    throw new Error("user has no firm");
  }

  const result = await pool.query(
    `
    SELECT *
    FROM firms
    WHERE id = $1
    LIMIT 1
    `,
    [user.firm_id]
  );

  return result.rows[0] || null;
}

function getPriceIdForPlan(plan) {
  const normalized = String(plan || "").toLowerCase();

  if (normalized === "pro") return process.env.STRIPE_PRICE_ID_PRO || "";
  if (normalized === "enterprise") return process.env.STRIPE_PRICE_ID_ENTERPRISE || "";

  return "";
}

export async function getBillingStatus(req, res, next) {
  try {
    await ensureBillingColumns();

    const firm = await getFirmForUser(req.user);

    if (!firm) {
      return res.status(404).json({ error: "firm not found" });
    }

    res.json({
      firm: {
        id: firm.id,
        name: firm.name,
        plan_tier: firm.plan_tier || "trial",
        stripe_customer_id: firm.stripe_customer_id || null,
        stripe_subscription_status: firm.stripe_subscription_status || null
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function createCheckoutSession(req, res, next) {
  try {
    await ensureBillingColumns();

    const stripe = getStripe();
    const firm = await getFirmForUser(req.user);

    if (!firm) {
      return res.status(404).json({ error: "firm not found" });
    }

    const { plan = "pro" } = req.body || {};
    const priceId = getPriceIdForPlan(plan);

    if (!priceId) {
      return res.status(400).json({ error: "missing Stripe price id for requested plan" });
    }

    let customerId = firm.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: firm.name,
        metadata: {
          firm_id: String(firm.id)
        }
      });

      customerId = customer.id;

      await pool.query(
        `
        UPDATE firms
        SET stripe_customer_id = $2, updated_at = NOW()
        WHERE id = $1
        `,
        [firm.id, customerId]
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: `${process.env.APP_BASE_URL}/billing?success=1`,
      cancel_url: `${process.env.APP_BASE_URL}/billing?canceled=1`,
      metadata: {
        firm_id: String(firm.id),
        requested_plan: String(plan)
      }
    });

    res.json({
      url: session.url
    });
  } catch (err) {
    next(err);
  }
}

export async function createBillingPortalSession(req, res, next) {
  try {
    await ensureBillingColumns();

    const stripe = getStripe();
    const firm = await getFirmForUser(req.user);

    if (!firm) {
      return res.status(404).json({ error: "firm not found" });
    }

    if (!firm.stripe_customer_id) {
      return res.status(400).json({ error: "no Stripe customer found for firm" });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: firm.stripe_customer_id,
      return_url: `${process.env.APP_BASE_URL}/billing`
    });

    res.json({
      url: portal.url
    });
  } catch (err) {
    next(err);
  }
}
