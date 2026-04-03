import { Server } from "socket.io";
import { subscribeToAll } from "./intelligence.events.js";

let ioInstance = null;

export function initSocket(server, allowedOrigins = []) {
  ioInstance = new Server(server, {
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : true,
      credentials: true
    }
  });

  ioInstance.on("connection", (socket) => {
    socket.on("join", (channel) => {
      if (typeof channel === "string" && channel.trim()) {
        socket.join(channel);
      }
    });

    socket.on("leave", (channel) => {
      if (typeof channel === "string" && channel.trim()) {
        socket.leave(channel);
      }
    });
  });

  subscribeToAll((event) => {
    if (!event?.channel) return;
    ioInstance.to(event.channel).emit("intelligence:event", event);
  });

  return ioInstance;
}

export function getIO() {
  return ioInstance;
}
