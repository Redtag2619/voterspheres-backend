import express from "express";
import dotenv from "dotenv";
import { candidateQueue } from "./queue.js";

dotenv.config();

const app = express();
app.use(express.json());

app.post("/generate-all", async (req, res) => {
  const { ids } = req.body;

  for (const id of ids) {
    await candidateQueue.add("generate", {
      candidateId: id
    });
  }

  res.json({ status: "queued", count: ids.length });
});

app.get("/", (req, res) => {
  res.send("Ultra Scale Generator Running");
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
