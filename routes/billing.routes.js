import express from "express"; 
import {
  getBillingConfig,
  createCheckoutSessionController,
  createBillingPortalSessionController,
  stripeWebhook,
} from "../controllers/billing.controller.js";

const router = express.Router();

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

router.get("/config", getBillingConfig);
router.post("/checkout-session", createCheckoutSessionController);
router.post("/portal-session", createBillingPortalSessionController);

export default router;
