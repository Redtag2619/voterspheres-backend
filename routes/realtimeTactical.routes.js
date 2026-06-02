import express from "express";
import { getRecentEvents } from "../lib/intelligence.events.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { emitRealtimeEvent } from "../services/realtime.service.js";

const router = express.Router();

router.get("/status", requireAuth, (req, res) => {
  res.json({
    ok: true,
    service: "Realtime Tactical Event Bus",
    recent_events: getRecentEvents(25),
    updated_at: new Date().toISOString(),
  });
});

router.post("/test", requireAuth, (req, res) => {
  const event = emitRealtimeEvent({
    type: req.body?.type || "realtime.test",
    channel: req.body?.channel || "voterspheres:global",
    workspace_id: req.body?.workspace_id || req.query?.workspace_id || null,
    firm_id: req.auth?.firmId || req.user?.firm_id || null,
    state: req.body?.state || null,
    payload: {
      message: req.body?.message || "Realtime Tactical Event Bus test event",
      source: "Realtime Tactical Event Bus",
      created_at: new Date().toISOString(),
    },
  });

  res.json({
    ok: true,
    event,
  });
});

export default router;
