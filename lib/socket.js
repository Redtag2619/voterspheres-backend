import { Server } from "socket.io";

import jwt from "jsonwebtoken";

import pool from "../config/database.js";

 

let io = null;

 

const INACTIVE_FIRM_STATUSES = new Set([

  "archived",

  "inactive",

  "disabled",

  "suspended",

]);

 

const INACTIVE_WORKSPACE_STATUSES = new Set([

  "archived",

  "inactive",

  "disabled",

]);

 

function clean(value = "") {

  return String(value ?? "").trim();

}

 

function normalizeOrigin(origin) {

  const value = clean(origin);

  if (!value) return "";

 

  try {

    return new URL(value).origin;

  } catch {

    return value.replace(/\/$/, "");

  }

}

 

function isAllowedOrigin(origin, allowedOrigins = []) {

  if (!origin) return true;

 

  const normalizedOrigin = normalizeOrigin(origin);

  const normalizedAllowed = new Set(

    (allowedOrigins || [])

      .map(normalizeOrigin)

      .filter(Boolean)

  );

 

  return normalizedAllowed.has(normalizedOrigin);

}

 

function getJwtSecret() {

  const secret = clean(process.env.JWT_SECRET);

 

  if (!secret) {

    throw new Error("JWT_SECRET is required for Socket.IO authentication.");

  }

 

  return secret;

}

 

function extractSocketToken(socket) {

  const authToken = clean(socket?.handshake?.auth?.token);

  if (authToken) return authToken;

 

  const authHeader = clean(socket?.handshake?.headers?.authorization);

  if (/^Bearer\s+/i.test(authHeader)) {

    return authHeader.replace(/^Bearer\s+/i, "").trim();

  }

 

  return "";

}

 

function normalizePositiveInteger(value) {

  if (value === null || value === undefined || value === "") return null;

 

  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) return null;

 

  return number;

}

 

function normalizeState(value) {

  const state = clean(value).toUpperCase();

  if (!state) return null;

  if (!/^[A-Z]{2}$/.test(state)) return null;

  return state;

}

 

function normalizeChannel(value) {

  const channel = clean(value);

  if (!channel) return null;

 

  if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(channel)) {

    return null;

  }

 

  return channel;

}

 

function firmRoom(firmId) {

  return `firm:${firmId}`;

}

 

function workspaceRoom(firmId, workspaceId) {

  return `firm:${firmId}:workspace:${workspaceId}`;

}

 

function stateRoom(firmId, state) {

  return `firm:${firmId}:state:${state}`;

}

 

function channelRoom(firmId, channel) {

  return `firm:${firmId}:channel:${channel}`;

}

 

async function authenticateSocket(socket) {

  const token = extractSocketToken(socket);

 

  if (!token) {

    const error = new Error("Missing bearer token");

    error.data = { status: 401 };

    throw error;

  }

 

  let payload;

 

  try {

    payload = jwt.verify(token, getJwtSecret(), {

      algorithms: ["HS256"],

    });

  } catch {

    const error = new Error("Unauthorized");

    error.data = { status: 401 };

    throw error;

  }

 

  const userId =

    payload?.id ||

    payload?.userId ||

    payload?.user_id ||

    payload?.sub ||

    null;

 

  const normalizedUserId = normalizePositiveInteger(userId);

 

  if (!normalizedUserId) {

    const error = new Error("Unable to determine authenticated user");

    error.data = { status: 401 };

    throw error;

  }

 

  const result = await pool.query(

    `

      SELECT

        u.id,

        u.first_name,

        u.last_name,

        u.email,

        u.role,

        u.firm_id,

        f.name AS firm_name,

        f.status AS firm_status,

        f.plan_tier

      FROM users u

      LEFT JOIN firms f

        ON f.id = u.firm_id

      WHERE u.id = $1

      LIMIT 1

    `,

    [normalizedUserId]

  );

 

  const user = result.rows?.[0] || null;

 

  if (!user) {

    const error = new Error("User not found");

    error.data = { status: 401 };

    throw error;

  }

 

  const firmId = normalizePositiveInteger(user.firm_id);

 

  if (!firmId) {

    const error = new Error("Authenticated user has no active firm context");

    error.data = { status: 403 };

    throw error;

  }

 

  if (!user.firm_name) {

    const error = new Error("Firm not found");

    error.data = { status: 403 };

    throw error;

  }

 

  const firmStatus = clean(user.firm_status || "active").toLowerCase();

 

  if (INACTIVE_FIRM_STATUSES.has(firmStatus)) {

    const error = new Error("Firm is not active");

    error.data = { status: 403 };

    throw error;

  }

 

  socket.data.auth = {

    token,

    payload,

  };

 

  socket.data.user = {

    id: user.id,

    first_name: user.first_name || "",

    last_name: user.last_name || "",

    email: user.email,

    role: user.role || "user",

    firm_id: firmId,

    firm_name: user.firm_name,

    firm_status: firmStatus,

    plan_tier: user.plan_tier || "starter",

  };

 

  socket.data.firmId = firmId;

}

 

async function validateWorkspaceAccess({ workspaceId, firmId }) {

  const normalizedWorkspaceId = normalizePositiveInteger(workspaceId);

 

  if (!normalizedWorkspaceId) {

    return { ok: false, reason: "Invalid workspace_id" };

  }

 

  const result = await pool.query(

    `

      SELECT id, firm_id, name, status

      FROM workspaces

      WHERE id = $1

        AND firm_id = $2

      LIMIT 1

    `,

    [normalizedWorkspaceId, firmId]

  );

 

  const workspace = result.rows?.[0] || null;

 

  if (!workspace) {

    return { ok: false, reason: "Workspace is not available for this firm" };

  }

 

  const status = clean(workspace.status || "active").toLowerCase();

 

  if (INACTIVE_WORKSPACE_STATUSES.has(status)) {

    return { ok: false, reason: "Workspace is archived, inactive, or disabled" };

  }

 

  return {

    ok: true,

    workspace: {

      id: workspace.id,

      firm_id: workspace.firm_id,

      name: workspace.name,

      status,

    },

  };

}

 

function safeAck(ack, payload) {

  if (typeof ack === "function") {

    try {

      ack(payload);

    } catch {

      // Client acknowledgements must never destabilize the socket server.

    }

  }

}

 

export function initSocket(server, allowedOrigins = []) {

  if (io) return io;

 

  io = new Server(server, {

    cors: {

      origin(origin, callback) {

        if (isAllowedOrigin(origin, allowedOrigins)) {

          return callback(null, true);

        }

 

        return callback(new Error("Socket CORS blocked"));

      },

      credentials: true,

      methods: ["GET", "POST"],

    },

    transports: ["websocket", "polling"],

  });

 

  io.use(async (socket, next) => {

    try {

      await authenticateSocket(socket);

      next();

    } catch (error) {

      next(error);

    }

  });

 

  io.on("connection", (socket) => {

    const firmId = socket.data.firmId;

    const userId = socket.data.user?.id;

 

    socket.join(firmRoom(firmId));

    socket.join(`firm:${firmId}:user:${userId}`);

 

    socket.on("voterspheres:subscribe", async (payload = {}, ack) => {

      try {

        const requestedWorkspaceId =

          payload?.workspace_id ??

          payload?.workspaceId ??

          null;

 

        const requestedState = normalizeState(payload?.state);

        const requestedChannel = normalizeChannel(payload?.channel);

 

        const joined = [];

 

        if (requestedWorkspaceId !== null && requestedWorkspaceId !== "") {

          const access = await validateWorkspaceAccess({

            workspaceId: requestedWorkspaceId,

            firmId,

          });

 

          if (!access.ok) {

            safeAck(ack, {

              ok: false,

              error: access.reason,

            });

            return;

          }

 

          const room = workspaceRoom(firmId, access.workspace.id);

          await socket.join(room);

          joined.push(room);

        }

 

        if (payload?.state && !requestedState) {

          safeAck(ack, {

            ok: false,

            error: "Invalid state",

          });

          return;

        }

 

        if (requestedState) {

          const room = stateRoom(firmId, requestedState);

          await socket.join(room);

          joined.push(room);

        }

 

        if (payload?.channel && !requestedChannel) {

          safeAck(ack, {

            ok: false,

            error: "Invalid channel",

          });

          return;

        }

 

        if (requestedChannel) {

          const room = channelRoom(firmId, requestedChannel);

          await socket.join(room);

          joined.push(room);

        }

 

        safeAck(ack, {

          ok: true,

          joined,

          firm_id: firmId,

        });

      } catch (error) {

        safeAck(ack, {

          ok: false,

          error: error?.message || "Subscription failed",

        });

      }

    });

 

    socket.on("voterspheres:unsubscribe", async (payload = {}, ack) => {

      const requestedWorkspaceId = normalizePositiveInteger(

        payload?.workspace_id ?? payload?.workspaceId

      );

      const requestedState = normalizeState(payload?.state);

      const requestedChannel = normalizeChannel(payload?.channel);

      const left = [];

 

      if (requestedWorkspaceId) {

        const room = workspaceRoom(firmId, requestedWorkspaceId);

        await socket.leave(room);

        left.push(room);

      }

 

      if (requestedState) {

        const room = stateRoom(firmId, requestedState);

        await socket.leave(room);

        left.push(room);

      }

 

      if (requestedChannel) {

        const room = channelRoom(firmId, requestedChannel);

        await socket.leave(room);

        left.push(room);

      }

 

      safeAck(ack, {

        ok: true,

        left,

        firm_id: firmId,

      });

    });

 

    socket.emit("voterspheres:ready", {

      ok: true,

      socket_id: socket.id,

      user_id: userId,

      firm_id: firmId,

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

 

  const firmId = normalizePositiveInteger(

    event.firm_id ||

    event.firmId ||

    event.payload?.firm_id ||

    null

  );

 

  if (!firmId) {

    console.warn(

      "[socket] realtime event skipped because firm_id is required",

      event?.type || "voterspheres.event"

    );

    return false;

  }

 

  const workspaceId = normalizePositiveInteger(

    event.workspace_id ||

    event.workspaceId ||

    event.payload?.workspace_id ||

    null

  );

 

  const state = normalizeState(

    event.state ||

    event.payload?.state ||

    null

  );

 

  const channel = normalizeChannel(

    event.channel ||

    null

  );

 

  const payload = {

    id: event.id || `${event.type || "event"}-${Date.now()}`,

    type: event.type || "voterspheres.event",

    channel,

    timestamp: event.timestamp || new Date().toISOString(),

    workspace_id: workspaceId,

    firm_id: firmId,

    state,

    payload: event.payload || {},

  };

 

  const rooms = new Set([firmRoom(firmId)]);

 

  if (workspaceId) {

    rooms.add(workspaceRoom(firmId, workspaceId));

  }

 

  if (state) {

    rooms.add(stateRoom(firmId, state));

  }

 

  if (channel) {

    rooms.add(channelRoom(firmId, channel));

  }

 

  let operator = io;

 

  for (const room of rooms) {

    operator = operator.to(room);

  }

 

  operator.emit("voterspheres:event", payload);

 

  return true;

}

