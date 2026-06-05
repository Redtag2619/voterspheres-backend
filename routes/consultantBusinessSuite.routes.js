import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createConsultantClient,
  createConsultantInvoice,
  createConsultantProject,
  createConsultantTimeEntry,
  getConsultantBusinessSuiteDashboard,
} from "../services/consultantBusinessSuite.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getConsultantBusinessSuiteDashboard({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[consultant-business-suite] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load Consultant Business Suite.",
      detail: error.message,
    });
  }
});

router.post("/clients", requireAuth, async (req, res) => {
  try {
    const client = await createConsultantClient({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, client });
  } catch (error) {
    console.error("[consultant-business-suite] client create failed", error);
    return res.status(500).json({
      error: "Failed to create consultant client.",
      detail: error.message,
    });
  }
});

router.post("/projects", requireAuth, async (req, res) => {
  try {
    const project = await createConsultantProject({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, project });
  } catch (error) {
    console.error("[consultant-business-suite] project create failed", error);
    return res.status(500).json({
      error: "Failed to create consultant project.",
      detail: error.message,
    });
  }
});

router.post("/invoices", requireAuth, async (req, res) => {
  try {
    const invoice = await createConsultantInvoice({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, invoice });
  } catch (error) {
    console.error("[consultant-business-suite] invoice create failed", error);
    return res.status(500).json({
      error: "Failed to create consultant invoice.",
      detail: error.message,
    });
  }
});

router.post("/time", requireAuth, async (req, res) => {
  try {
    const entry = await createConsultantTimeEntry({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, entry });
  } catch (error) {
    console.error("[consultant-business-suite] time create failed", error);
    return res.status(500).json({
      error: "Failed to create time entry.",
      detail: error.message,
    });
  }
});

export default router;
