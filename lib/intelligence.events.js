import { emitSocketEvent } from "./socket.js";

const listeners = new Set();
const recentEvents = [];

function normalizeEvent(event = {}) {
  return {
    id: event.id || `${event.type || "event"}-${Date.now()}`,
    type: event.type || "voterspheres.event",
    channel: event.channel || "voterspheres:global",
    timestamp: event.timestamp || new Date().toISOString(),
    workspace_id: event.workspace_id || event.workspaceId || event.payload?.workspace_id || null,
    firm_id: event.firm_id || event.firmId || event.payload?.firm_id || null,
    state: event.state || event.payload?.state || null,
    payload: event.payload || {},
  };
}

export function publishEvent(event = {}) {
  const normalized = normalizeEvent(event);

  recentEvents.unshift(normalized);
  recentEvents.splice(100);

  emitSocketEvent(normalized);

  for (const listener of listeners) {
    try {
      listener(normalized);
    } catch (error) {
      console.warn("[intelligence.events] listener failed", error?.message || error);
    }
  }

  return normalized;
}

export function subscribeToEvents(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function onIntelligenceEvent(listener) {
  return subscribeToEvents(listener);
}

export function getRecentEvents(limit = 50) {
  return recentEvents.slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
}

export function clearRecentEvents() {
  recentEvents.length = 0;
}
