import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getExecutiveKpis } from "../services/executiveKpi.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getExecutiveKpis({
      user: {
        ...(req.user || {}),
        ...(req.auth || {}),
        firm_id:
          req.auth?.firmId ||
          req.auth?.firm_id ||
          req.user?.firm_id ||
          null,
      },
    });

    return res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error("[executive-kpi] failed:", error);

    return res.status(500).json({
      ok: false,
      error: "Failed to load Executive KPI Layer.",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : error.message,
    });
  }
});

export default router;
