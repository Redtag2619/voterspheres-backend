import express from "express";
import {
  createCheckoutSession,
  handleStripeWebhook
} from "../services/billing.service.js";

const router = express.Router();

router.post("/checkout/session", createCheckoutSession);

export default router;
export { handleStripeWebhook };
