import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function publishEvent(event) {
  bus.emit("intelligence:event", event);

  if (event?.channel) {
    bus.emit(`channel:${event.channel}`, event);
  }
}

export function subscribeToChannel(channel, handler) {
  const key = `channel:${channel}`;
  bus.on(key, handler);
  return () => bus.off(key, handler);
}

export function subscribeToAll(handler) {
  bus.on("intelligence:event", handler);
  return () => bus.off("intelligence:event", handler);
}
