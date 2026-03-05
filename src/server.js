import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import candidatesRoutes from "./src/routes/candidates.routes.js";
import dropdownRoutes from "./src/routes/dropdowns.routes.js";

dotenv.config();

const app = express();

/* ===============================
   Middleware
================================ */

app.use(cors({
  origin: [
    "https://voterspheres.org",
    "https://www.voterspheres.org",
    "http://localhost:5173"
  ],
  credentials: true
}));

app.use(express.json());


/* ===============================
   Health Check
================================ */

app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API running",
    version: "1.0",
    service: "Political Intelligence Platform"
  });
});


/* ===============================
   API Routes
================================ */

app.use("/candidates", candidatesRoutes);

app.use("/dropdowns", dropdownRoutes);


/* ===============================
   404 Handler
================================ */

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});


/* ===============================
   Global Error Handler
================================ */

app.use((err, req, res, next) => {
  console.error("Server Error:", err);

  res.status(500).json({
    error: "Internal Server Error"
  });
});


/* ===============================
   Server
================================ */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 VoterSpheres API running on port ${PORT}`);
});
