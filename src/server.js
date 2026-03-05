import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import candidatesRoutes from "./routes/candidates.routes.js";
import dropdownRoutes from "./routes/dropdowns.routes.js";

dotenv.config();

const app = express();

/* =========================
   Middleware
========================= */

app.use(cors({
  origin: [
    "https://voterspheres.org",
    "https://www.voterspheres.org",
    "http://localhost:5173"
  ]
}));

app.use(express.json());


/* =========================
   Health Check
========================= */

app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API running"
  });
});


/* =========================
   API Routes
========================= */

app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);


/* =========================
   404 Handler
========================= */

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});


/* =========================
   Server
========================= */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
