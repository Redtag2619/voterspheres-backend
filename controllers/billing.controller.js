import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import {
  createCheckoutSession,
  createBillingPortalSession,
  constructStripeEvent,
  handleStripeWebhookEvent,
} from "../services/billing.service.js";

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

async function getAuthedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    const error = new Error("Missing bearer token");
    error.statusCode = 401;
    throw error;
  }

  if (!process.env.JWT_SECRET) {
    const error = new Error("Missing JWT_SECRET");
    error.statusCode = 500;
    throw error;
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const error = new Error("Invalid or expired token");
    error.statusCode = 401;
    throw error;
  }

  const firmIdFromToken =
    payload?.firm_id ||
    payload?.firmId ||
    payload?.user?.firm_id ||
    payload?.user?.firmId ||
    null;

  const userId =
    payload?.id ||
    payload?.userId ||
    payload?.user_id ||
    payload?.sub ||
    payload?.user?.id ||
    null;

  if (firmIdFromToken) {
    return {
      token,
      payload,
      userId,
      firmId: Number(firmIdFromToken),
    };
  }

  if (!userId) {
    const error = new Error("Unable to determine user from token");
    error.statusCode = 401;
    throw error;
  }

  const result = await pool.query(
    `
      SELECT id, email, role, firm_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    const error = new Error("User not found");
    error.statusCode = 401;
    throw error;
  }

  const user = result.rows[0];

  if (!user.firm_id) {
    const error = new Error("No firm is linked to this user");
    error.statusCode = 403;
    throw error;
  }

  return {
    token,
    payload,
    userId: user.id,
    firmId: user.firm_id,
    user,
  };
}

export async function getBillingConfig(req, res) {
  try {
    return res.status(200).json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
      prices: {
        starter: process.env.STRIPE_PRICE_STARTER || "",
        pro: process.env.STRIPE_PRICE_PRO || "",
        enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "",
      },
    });
  } catch (error) {
    console.error("getBillingConfig error:", error);
    return res.status(500).json({
      error: "Failed to load billing config",
      message: error.message,
    });
  }
}

export async function createCheckoutSessionController(req, res) {
  try {
    const { firmId } = await getAuthedUser(req);
    const { priceId, successUrl, cancelUrl } = req.body || {};

    if (!priceId) {
      return res.status(400).json({
        error: "priceId is required",
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    const session = await createCheckoutSession({
      firmId,
      priceId,
      successUrl: successUrl || `${frontendUrl}/billing?success=1`,
      cancelUrl: cancelUrl || `${frontendUrl}/billing?canceled=1`,
    });

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("createCheckoutSessionController error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to create checkout session",
    });
  }
}

export async function createBillingPortalSessionController(req, res) {
  try {
    const { firmId } = await getAuthedUser(req);
    const { returnUrl } = req.body || {};

    const firmResult = await pool.query(
      `
        SELECT stripe_customer_id
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [firmId]
    );

    if (firmResult.rows.length === 0) {
      return res.status(404).json({
        error: "Firm not found",
      });
    }

    const customerId = firmResult.rows[0].stripe_customer_id;

    if (!customerId) {
      return res.status(400).json({
        error: "No Stripe customer exists for this firm yet",
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    const session = await createBillingPortalSession({
      customerId,
      returnUrl: returnUrl || `${frontendUrl}/billing`,
    });

    return res.status(200).json({
      url: session.url,
    });
  } catch (error) {
    console.error("createBillingPortalSessionController error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to create billing portal session",
    });
  }
}

export async function getMyBillingDebug(req, res) {
  try {
    const { firmId, userId } = await getAuthedUser(req);

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
          last_webhook_event_id,
          last_webhook_event_type,
          last_webhook_event_at,
          updated_at
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [firmId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Firm not found",
      });
    }

    const firm = result.rows[0];

    return res.status(200).json({
      ok: true,
      user_id: userId || null,
      firm_id: firm.id,
      firm_name: firm.firm_name || firm.name || null,
      email: firm.email || null,
      plan_tier: firm.plan_tier || "free",
      status: firm.status || "inactive",
      stripe_customer_id: firm.stripe_customer_id || null,
      stripe_subscription_id: firm.stripe_subscription_id || null,
      last_webhook_event_id: firm.last_webhook_event_id || null,
      last_webhook_event_type: firm.last_webhook_event_type || null,
      last_webhook_event_at: firm.last_webhook_event_at || null,
      updated_at: firm.updated_at || null,
    });
  } catch (error) {
    console.error("getMyBillingDebug error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to load billing debug info",
    });
  }
}

export async function stripeWebhook(req, res) {
  try {
    const signature = req.headers["stripe-signature"];
    const event = constructStripeEvent(req.body, signature);

    await handleStripeWebhookEvent(event);

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("stripeWebhook error:", error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}
