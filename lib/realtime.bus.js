const clients = new Set();

export function addRealtimeClient(res) {
  clients.add(res);

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ ok: true, connected_at: new Date().toISOString() })}\n\n`);

  return () => {
    clients.delete(res);
  };
}

export function publishRealtimeEvent(event = {}) {
  const payload = {
    id: event.id || `evt-${Date.now()}`,
    type: event.type || "intelligence.update",
    channel: event.channel || "intelligence:global",
    timestamp: event.timestamp || new Date().toISOString(),
    payload: event.payload || {}
  };

  for (const client of clients) {
    try {
      client.write(`event: ${payload.type}\n`);
      client.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      clients.delete(client);
    }
  }

  return payload;
}

export function getRealtimeClientCount() {
  return clients.size;
}
