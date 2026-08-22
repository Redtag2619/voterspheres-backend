import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  PLAN_CATALOG,
  getUsage,
  resolveFirmEntitlements,
  SUBSCRIPTION_ENTITLEMENT_BUILD,
} from "../services/subscriptionEntitlements.service.js";

const router = Router();

router.get("/catalog", (_req, res) => {
  const publicCatalog = Object.fromEntries(
    Object.entries(PLAN_CATALOG)
      .filter(([key]) => key !== "free")
      .map(([key, plan]) => [
        key,
        {
          key: plan.key,
          label: plan.label,
          monthlyPrice: plan.monthlyPrice,
          limits: plan.limits,
        },
      ])
  );
  res.json({ ok: true, build: SUBSCRIPTION_ENTITLEMENT_BUILD, plans: publicCatalog });
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const access = await resolveFirmEntitlements({
      firmId: req.user?.firm_id,
      planTier: req.user?.plan_tier,
      user: req.user,
    });
    const usage = access.platformAdmin ? {} : await getUsage(req.user?.firm_id);
    res.json({
      ok: true,
      ...access,
      usage,
      subscriptionStatus: req.user?.subscription_status || null,
      currentPeriodEnd: req.user?.current_period_end || null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;


