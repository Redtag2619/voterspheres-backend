import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import votersRoutes from "./routes/voters.routes.js";
import { authenticate } from "./middleware/auth.js";

dotenv.config();

const app = express();

/*
|--------------------------------------------------------------------------
| Security Middleware
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Rate Limiting
|--------------------------------------------------------------------------
*/

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);

/*
|--------------------------------------------------------------------------
| Health Routes
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API is live 🚀",
    environment: process.env.NODE_ENV || "development"
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

app.use("/auth", authLimiter, authRoutes);
app.use("/voters", votersRoutes);

/*
|--------------------------------------------------------------------------
| Example Protected Route
|--------------------------------------------------------------------------
*/

app.get("/protected", authenticate, (req, res) => {
  res.json({
    message: "Protected route access granted",
    user: req.user
  });
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({
    message: "Internal Server Error"
  });
});

/*
|--------------------------------------------------------------------------
| Server Startup
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
