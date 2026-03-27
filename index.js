import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { pool } from "./db/pool.js";

import candidatesRoutes from "./routes/candidates.routes.js";
import consultantsRoutes from "./routes/consultants.routes.js";
import vendorsRoutes from "./routes/vendors.routes.js";
import intelligenceRoutes from "./routes/intelligence.routes.js";
import mapRoutes from "./routes/map.routes.js";
import fecRoutes from "./routes/fec.routes.js";
import forecastRoutes from "./routes/forecast.routes.js";
import crmRoutes from "./routes/crm.routes.js";
import crmDashboardRoutes from "./routes/crmDashboard.routes.js";
import firmWorkspaceRoutes from "./routes/firmWorkspace.routes.js";
import mailRoutes from "./routes/mail.routes.js";
import platformRoutes from "./routes/platform.routes.js";
import alertsRoutes from "./routes/alerts.routes.js";
import campaignCommandRoutes from "./routes/campaignCommand.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import authRoutes from "./routes/auth.routes.js";

import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import {
  requireStarter,
  requirePro,
  requireEnterprise,
} from "./middleware/requirePlan.js";

import { startFundraisingIngestionJob } from "./jobs/fundraisingIngestion.job.js";
import { startForecastScheduler } from "./jobs/forecastScheduler.job.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const explicitAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://voterspheres.org",
  "https://www.voterspheres.org",
  process.env.FRONTEND_URL,
  process.env.VERCEL_FRONTEND_URL,
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (explicitAllowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);

    if (
      url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.app")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// IMPORTANT:
// Mount billing BEFORE express.json()
// so Stripe webhook raw body remains intact.
app.use("/api/billing", billingRoutes);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "VoterSpheres Backend",
  });
});

app.get("/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "ok",
    });
  } catch (err) {
    next(err);
  }
});

app.use("/api/auth", authRoutes);

// Public routes
app.use("/api/candidates", candidatesRoutes);
app.use("/api/vendors", vendorsRoutes);
app.use("/api/map", mapRoutes);

// Path-level premium enforcement for mixed routers
app.use("/api/intelligence/forecast", requirePro);
app.use("/api/intelligence/rankings", requirePro);
app.use("/api/intelligence/fundraising", requireEnterprise);
app.use("/api/fec/fundraising", requireEnterprise);

// Mixed/public routers mounted after targeted gates
app.use("/api/intelligence", intelligenceRoutes);
app.use("/api/fec", fecRoutes);

// Starter tier
app.use("/api/crm", requireStarter, crmRoutes);
app.use("/api/crm-dashboard", requireStarter, crmDashboardRoutes);
app.use("/api/firms", requireStarter, firmWorkspaceRoutes);

// Pro tier
app.use("/api/forecast", requirePro, forecastRoutes);
app.use("/api/alerts", requirePro, alertsRoutes);
app.use("/api/campaigns", requirePro, campaignCommandRoutes);

// Enterprise tier
app.use("/api/consultants", requireEnterprise, consultantsRoutes);
app.use("/api/mail", requireEnterprise, mailRoutes);
app.use("/api/platform", requireEnterprise, platformRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connection verified");

    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 Backend running on http://${HOST}:${PORT}`);

      try {
        startFundraisingIngestionJob();
      } catch (jobErr) {
        console.error("Failed to start fundraising ingestion job:", jobErr);
      }

      try {
        startForecastScheduler();
      } catch (jobErr) {
        console.error("Failed to start forecast scheduler:", jobErr);
      }
    });

    server.on("error", (err) => {
      console.error("SERVER ERROR:", err);
      process.exit(1);
    });
  } catch (err) {
    console.error("FAILED TO START SERVER:", err);
    process.exit(1);
  }
}

startServer();
