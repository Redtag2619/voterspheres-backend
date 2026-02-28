import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

import { authenticate } from "./middleware/auth.js";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();

const app = express();

/*
|--------------------------------------------------------------------------
| Middleware
|--------------------------------------------------------------------------
*/

// Security headers
app.use(helmet());

// JSON parsing
app.use(express.json());

// CORS Configuration
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
| Health & Root Routes
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

app.use("/auth", authRoutes);

// Example protected route (for testing JWT)
app.get("/protected", authenticate, (req, res) => {
  res.json({
    message: "You have accessed a protected route",
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
