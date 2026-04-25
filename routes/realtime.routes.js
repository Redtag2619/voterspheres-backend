import express from "express";
import {
  addRealtimeClient,
  getRealtimeClientCount
} from "../lib/realtime.bus.js";

const router = express.Router();

router.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const removeClient = addRealtimeClient(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      removeClient();
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient();
  });
});

router.get("/status", (_req, res) => {
  res.json({
    ok: true,
    clients: getRealtimeClientCount(),
    timestamp: new Date().toISOString()
  });
});

export default router;
