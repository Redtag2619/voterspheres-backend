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
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
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
      "/api/candidates/dropdowns/counties",

      "/api/consultants",
      "/api/consultants/dropdowns/states",

      "/api/vendors",
      "/api/vendors/dropdowns/states",

      "/api/intelligence/summary",
      "/api/intelligence/dashboard",
      "/api/intelligence/forecast",
      "/api/intelligence/rankings",
      "/api/intelligence/map",
      "/api/intelligence/fundraising/live",
      "/api/intelligence/fundraising/leaderboard",
      "/api/intelligence/fundraising/ingest",

      "/api/map/geojson/states",
      "/api/map/geojson/states/:stateName",
      "/api/map/ingest",

      "/api/fec/ingest",
      "/api/fec/candidates",
      "/api/fec/fundraising",

      "/api/forecast/rebuild",
      "/api/forecast/published",
      "/api/forecast/overlays",

      "/api/crm/init",
      "/api/crm/firms",
      "/api/crm/users",
      "/api/crm/campaigns",
      "/api/crm/campaigns/:id",
      "/api/crm/campaigns/:id/contacts",
      "/api/crm/campaigns/:id/vendors",
      "/api/crm/campaigns/:id/tasks",
      "/api/crm/campaigns/:id/documents",

      "/api/crm-dashboard/summary",

      "/api/firms/:id/workspace"
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
app.use("/api/consultants", consultantsRoutes);
app.use("/api/vendors", vendorsRoutes);
app.use("/api/intelligence", intelligenceRoutes);
app.use("/api/map", mapRoutes);
app.use("/api/fec", fecRoutes);
app.use("/api/forecast", forecastRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/crm-dashboard", crmDashboardRoutes);
app.use("/api/firms", firmWorkspaceRoutes);

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
    });
  } catch (err) {
    console.error("FAILED TO START SERVER:", err);
    process.exit(1);
  }
}

startServer();
