import { Queue } from "bullmq";
import { redis } from "./redis.js";

export const candidateQueue = new Queue("candidateQueue", {
  connection: redis
});
