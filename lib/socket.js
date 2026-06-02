import { Server } from "socket.io";

let io = null;

function isAllowedOrigin(origin, allowedOrigins = []) {
  if (!origin) return true;
  if (origin.includes("vercel.app")) return true;
  return allowedOrigins.includes(origin);
}

export function initSocket(server, allowedOrigins = []) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin(origin, callback) {
        if (isAllowedOrigin(origin, allowedOrigins)) {
          return callback(null, true);
        }

        return callback(new Error(`Socket CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    socket.join("voterspheres:global");

    socket.on("voterspheres:subscribe", (payload = {}) => {
      const workspaceId = payload.workspace_id || payload.workspaceId;
      const firmId = payload.firm_id || payload.firmId;
      const state = payload.state;

      if (workspaceId) socket.join(`workspace:${workspaceId}`);
      if (firmId) socket.join(`firm:${firmId}`);
      if (state) socket.join(`state:${String(state).toUpperCase()}`);
    });

    socket.on("voterspheres:unsubscribe", (payload = {}) => {
      const workspaceId = payload.workspace_id || payload.workspaceId;
      const firmId = payload.firm_id || payload.firmId;
      const state = payload.state;

      if (workspaceId) socket.leave(`workspace:${workspaceId}`);
      if (firmId) socket.leave(`firm:${firmId}`);
      if (state) socket.leave(`state:${String(state).toUpperCase()}`);
    });

    socket.emit("voterspheres:ready", {
      ok: true,
      socket_id: socket.id,
      connected_at: new Date().toISOString(),
    });
  });

  console.log("✅ Realtime Tactical Event Bus enabled");

  return io;
}

export function getSocketServer() {
  return io;
}

export function emitSocketEvent(event = {}) {
  if (!io) return false;

  const payload = {
    id: event.id || `${event.type || "event"}-${Date.now()}`,
    type: event.type || "voterspheres.event",
    channel: event.channel || "voterspheres:global",
    timestamp: event.timestamp || new Date().toISOString(),
    workspace_id: event.workspace_id || event.workspaceId || event.payload?.workspace_id || null,
    firm_id: event.firm_id || event.firmId || event.payload?.firm_id || null,
    state: event.state || event.payload?.state || null,
    payload: event.payload || {},
  };

  io.to("voterspheres:global").emit("voterspheres:event", payload);
  io.to(payload.channel).emit("voterspheres:event", payload);

  if (payload.workspace_id) {
    io.to(`workspace:${payload.workspace_id}`).emit("voterspheres:event", payload);
  }

  if (payload.firm_id) {
    io.to(`firm:${payload.firm_id}`).emit("voterspheres:event", payload);
  }

  if (payload.state) {
    io.to(`state:${String(payload.state).toUpperCase()}`).emit("voterspheres:event", payload);
  }

  return true;
}
