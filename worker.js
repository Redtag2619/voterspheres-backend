import { Worker } from "bullmq";
import axios from "axios";
import dotenv from "dotenv";
import { redis } from "./redis.js";

dotenv.config();

const concurrency = Number(process.env.CONCURRENCY || 25);

const worker = new Worker(
  "candidateQueue",
  async job => {
    const { candidateId } = job.data;

    console.log("Processing candidate:", candidateId);

    await axios.get(`${process.env.API_BASE}/generate/${candidateId}`);

    console.log("Finished:", candidateId);
  },
  {
    connection: redis,
    concurrency
  }
);

worker.on("completed", job => {
  console.log(`Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`Failed job ${job?.id}`, err);
});
