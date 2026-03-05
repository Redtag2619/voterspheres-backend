import billingRoutes from "./routes/billing.routes.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import candidatesRoutes from "./routes/candidates.routes.js";
import authRoutes from "./routes/auth.routes.js";
import dropdownRoutes from "./src/routes/dropdowns.routes.js";

dotenv.config();

const app = express();

/* -----------------------------
   CORE MIDDLEWARE
------------------------------ */

app.use(cors({
  origin: true,
  credentials: true
}));

app.use("/billing/webhook", express.raw({ type: "application/json" }));
app.use("/billing", billingRoutes);
app.use(express.json());

/* -----------------------------
   HEALTH CHECK
------------------------------ */

app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API Running",
    environment: process.env.NODE_ENV || "development"
  });
});

/* -----------------------------
   ROUTES
------------------------------ */

app.use("/auth", authRoutes);
app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);

/* -----------------------------
   GLOBAL ERROR HANDLER
------------------------------ */

app.use((err, req, res, next) => {
  console.error("Global Error:", err);
  res.status(500).json({
    error: "Internal Server Error"
  });
});

/* -----------------------------
   START SERVER
------------------------------ */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
