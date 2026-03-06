import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import candidatesRoutes from "./routes/candidates.routes.js";
import votersRoutes from "./routes/voters.routes.js";
import intelligenceRoutes from "./routes/intelligence.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "VoterSpheres Intelligence API Running" });
});

app.use("/candidates", candidatesRoutes);
app.use("/voters", votersRoutes);
app.use("/intelligence", intelligenceRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
