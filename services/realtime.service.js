let ioInstance = null;

export function initRealtime(io) {
  ioInstance = io;
  return ioInstance;
}

export function getRealtime() {
  return ioInstance;
}

export function emitTaskEvent(event, payload = {}) {
  if (!ioInstance) return;

  ioInstance.emit(event, {
    ...payload,
    emitted_at: new Date().toISOString()
  });

  ioInstance.to("tasks").emit(event, {
    ...payload,
    emitted_at: new Date().toISOString()
  });
}
