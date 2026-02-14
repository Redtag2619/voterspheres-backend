import axios from "axios";
import pLimit from "p-limit";
import dotenv from "dotenv";
import { candidateQueue } from "./queue.js";

dotenv.config();

const limit = pLimit(100);

async function loadCandidates() {
  const res = await axios.get(`${process.env.API_BASE}/candidates`);
  return res.data;
}

async function enqueueAll() {
  const candidates = await loadCandidates();

  console.log(`Loaded ${candidates.length} candidates`);

  await Promise.all(
    candidates.map(candidate =>
      limit(() =>
        candidateQueue.add("generate", {
          candidateId: candidate.id
        })
      )
    )
  );

  console.log("All candidates queued");
}

enqueueAll();
