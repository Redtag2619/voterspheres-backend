import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { pool } from "./db/pool.js";
import candidatesRoutes from "./routes/candidates.routes.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "VoterSpheres Backend",
    routes: [
      "/health",
      "/api/candidates",
      "/api/candidates/dropdowns/states",
      "/api/candidates/dropdowns/offices",
      "/api/candidates/dropdowns/parties",
      "/api/candidates/dropdowns/counties"
    ]
  });
});

app.get("/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "ok"
    });
  } catch (err) {
    next(err);
  }
});

app.use("/api/candidates", candidatesRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
