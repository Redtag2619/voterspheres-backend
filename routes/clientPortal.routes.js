import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createClientPortalAccess,
  getClientPortalDashboardByToken,
  listClientPortalAccess,
  revokeClientPortalAccess,
  updateClientPortalAccess,
} from "../services/clientPortal.service.js";

const router = express.Router();

router.get("/admin/clients", requireAuth, async (req, res) => {
  try {
    const clients = await listClientPortalAccess({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, clients });
  } catch (error) {
    console.error("[client-portal] list failed", error);
    return res.status(500).json({
      error: "Failed to load client portal access.",
      detail: error.message,
    });
  }
});

router.post("/admin/clients", requireAuth, async (req, res) => {
  try {
    const client = await createClientPortalAccess({
      user: req.user || req.auth || {},
      payload: req.body || {},
    });

    return res.status(201).json({ ok: true, client });
  } catch (error) {
    console.error("[client-portal] create failed", error);
    return res.status(500).json({
      error: "Failed to create client portal access.",
      detail: error.message,
    });
  }
});

router.put("/admin/clients/:id", requireAuth, async (req, res) => {
  try {
    const client = await updateClientPortalAccess({
      user: req.user || req.auth || {},
      id: req.params.id,
      payload: req.body || {},
    });

    return res.json({ ok: true, client });
  } catch (error) {
    console.error("[client-portal] update failed", error);
    return res.status(500).json({
      error: "Failed to update client portal access.",
      detail: error.message,
    });
  }
});

router.put("/admin/clients/:id/revoke", requireAuth, async (req, res) => {
  try {
    const client = await revokeClientPortalAccess({
      user: req.user || req.auth || {},
      id: req.params.id,
    });

    return res.json({ ok: true, client });
  } catch (error) {
    console.error("[client-portal] revoke failed", error);
    return res.status(500).json({
      error: "Failed to revoke client portal access.",
      detail: error.message,
    });
  }
});

router.get("/public/:token", async (req, res) => {
  try {
    const data = await getClientPortalDashboardByToken({
      token: req.params.token,
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[client-portal] public portal failed", error);
    return res.status(404).json({
      error: "Client portal unavailable.",
      detail: error.message,
    });
  }
});

export default router;
