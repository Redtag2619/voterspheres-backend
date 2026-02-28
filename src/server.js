import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import candidatesRoutes from "./routes/voters.routes.js"; // this handles /candidates
import dropdownRoutes from "./routes/dropdowns.routes.js";

dotenv.config();

const app = express();

/* ==========================================================================
   MIDDLEWARE
========================================================================== */

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: [
      "https://voterspheres.org",
      "https://www.voterspheres.org",
      "https://voterspheres-frontend.vercel.app"
    ],
    credentials: true
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
});

app.use(limiter);

/* ==========================================================================
   ROOT & HEALTH
========================================================================== */

app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API is live 🚀"
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* ==========================================================================
   ROUTES
========================================================================== */

app.use("/auth", authRoutes);
app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);

/* ==========================================================================
   404 HANDLER (IMPORTANT)
   Always return JSON — never HTML
========================================================================== */

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

/* ==========================================================================
   GLOBAL ERROR HANDLER
========================================================================== */

app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({
    error: "Internal Server Error"
  });
});

/* ==========================================================================
   START SERVER
========================================================================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
