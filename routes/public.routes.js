import express from "express";
import { createEnterpriseLead } from "../controllers/public.controller.js";

const router = express.Router();

router.post("/enterprise-leads", createEnterpriseLead);

export default router;
