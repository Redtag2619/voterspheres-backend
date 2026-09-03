import express from "express";

import { getRecentEvents } from "../lib/intelligence.events.js";

import { requireAuth } from "../middleware/auth.middleware.js";

import { emitRealtimeEvent } from "../services/realtime.service.js";

 

const router = express.Router();

 

function authenticatedFirmId(req) {

  const value = req.auth?.firmId || req.user?.firm_id || null;

  const number = Number(value);

 

  if (!Number.isInteger(number) || number <= 0) return null;

  return number;

}

 

router.get("/status", requireAuth, (req, res) => {

  const firmId = authenticatedFirmId(req);

 

  if (!firmId) {

    return res.status(403).json({

      ok: false,

      error: "Authenticated firm context is required",

    });

  }

 

  return res.json({

    ok: true,

    service: "Realtime Tactical Event Bus",

    firm_id: firmId,

    recent_events: getRecentEvents(25, { firmId }),

    updated_at: new Date().toISOString(),

  });

});

 

router.post("/test", requireAuth, (req, res) => {

  const firmId = authenticatedFirmId(req);

 

  if (!firmId) {

    return res.status(403).json({

      ok: false,

      error: "Authenticated firm context is required",

    });

  }

 

  const event = emitRealtimeEvent({

    type: req.body?.type || "realtime.test",

    channel: req.body?.channel || "realtime:test",

    workspace_id: req.body?.workspace_id || req.query?.workspace_id || null,

    firm_id: firmId,

    state: req.body?.state || null,

    payload: {

      message: req.body?.message || "Realtime Tactical Event Bus test event",

      source: "Realtime Tactical Event Bus",

      created_at: new Date().toISOString(),

    },

  });

 

  return res.json({

    ok: true,

    event,

  });

});

 

export default router;
