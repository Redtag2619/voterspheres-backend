import { Server } from "socket.io";
import { subscribeToAll } from "./intelligence.events.js";

let io;

export function initSocket(server, corsOrigins = []) {
  io = new Server(server, {
    cors: {
      origin: corsOrigins,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
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
    io.to(event.channel).emit("intelligence:event", event);
  });

  return io;
}

export function getIO() {
  return io;
}
