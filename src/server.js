import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import votersRoutes from "./routes/voters.routes.js";
import dropdownRoutes from "./routes/dropdowns.routes.js";
import { authenticate } from "./middleware/auth.js";

dotenv.config();

const app = express();

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

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

app.use(globalLimiter);

app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API is live 🚀"
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/

app.use("/auth", authRoutes);
app.use("/voters", votersRoutes);
app.use("/dropdowns", dropdownRoutes);

/*
|--------------------------------------------------------------------------
| Error Handler
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal Server Error" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
