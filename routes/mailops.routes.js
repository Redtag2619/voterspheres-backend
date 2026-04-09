import express from "express";
import { getMailOpsDashboard } from "../controllers/mailops.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/dashboard", requireAuth, getMailOpsDashboard);

export default router;
