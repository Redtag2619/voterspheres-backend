import express from "express";
import { getExecutiveDashboard } from "../services/platform.service.js";

const router = express.Router();

router.get("/executive-dashboard", getExecutiveDashboard);

export default router;
