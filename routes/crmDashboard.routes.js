import express from "express";
import { getCrmDashboardSummary } from "../services/crmDashboard.service.js";

const router = express.Router();

router.get("/summary", getCrmDashboardSummary);

export default router;
