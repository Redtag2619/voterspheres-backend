import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getLaunchSeederStatus,
  runLaunchDataSeeder,
} from "../services/launchDataSeeder.service.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getLaunchSeederStatus({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-data-seeder] status failed", error);
    return res.status(500).json({
      error: "Failed to load Launch Data Seeder.",
      detail: error.message,
    });
  }
});

router.post("/run", requireAuth, async (req, res) => {
  try {
    const data = await runLaunchDataSeeder({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[launch-data-seeder] run failed", error);
    return res.status(500).json({
      error: "Failed to run Launch Data Seeder.",
      detail: error.message,
    });
  }
});

export default router;
