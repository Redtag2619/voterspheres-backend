import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/auth.middleware.js";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getBillingStatus
} from "../services/billing.service.js";

const router = express.Router();

router.get("/status", requireAuth, getBillingStatus);
router.post("/checkout", requireAuth, requireRole("admin", "manager", "platform_admin"), createCheckoutSession);
router.post("/portal", requireAuth, requireRole("admin", "manager", "platform_admin"), createBillingPortalSession);

export default router;
