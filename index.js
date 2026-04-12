import "dotenv/config"; 
import express from "express"; 
import http from "http"; 
import cors from "cors";
import helmet from "helmet"; 
import morgan from "morgan"; 

import authRoutes from "./routes/auth.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import alertsRoutes from "./routes/alerts.routes.js";
import crmRoutes from "./routes/crm.routes.js";
import crmDashboardRoutes from "./routes/crmDashboard.routes.js";
import firmWorkspaceRoutes from "./routes/firmWorkspace.routes.js";
import campaignCommandRoutes from "./routes/campaignCommand.routes.js";
import mailRoutes from "./routes/mail.routes.js";
import platformRoutes from "./routes/platform.routes.js";
import intelligenceRoutes from "./routes/intelligence.routes.js";
import forecastRoutes from "./routes/forecast.routes.js";
import fecRoutes from "./routes/fec.routes.js";
import candidatesRoutes from "./routes/candidates.routes.js";
import vendorsRoutes from "./routes/vendors.routes.js";
import statesRoutes from "./routes/states.routes.js";
import donorsRoutes from "./routes/donors.routes.js";
import consultantsRoutes from "./routes/consultants.routes.js";
import mailOpsRoutes from "./routes/mailops.routes.js";
import publicRoutes from "./routes/public.routes.js"; 

import { requireAuth } from "./middleware/auth.middleware.js";
import { initSocket } from "./lib/socket.js";
import { publishEvent } from "./lib/intelligence.events.js";

const app = express();

const PORT = Number(process.env.PORT || 10000);

const ALLOWED_ORIGINS = [
  "https://voterspheres.org",
  "https://www.voterspheres.org",
  "https://voterspheres-frontend-git-main-mark-j-stephens-projects.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
  })
);

app.options("*", cors());

app.use(
  morgan(process.env.NODE_ENV === "production" ? "combined" : "dev")
);

app.use(
  "/api/billing/webhook",
  express.raw({ type: "application/json" })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "VoterSpheres Backend",
    live_intelligence: true,
    port: PORT,
  });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/billing", billingRoutes);

app.use("/api/alerts", requireAuth, alertsRoutes);
app.use("/api/crm", requireAuth, crmRoutes);
app.use("/api/crm-dashboard", requireAuth, crmDashboardRoutes);
app.use("/api/firms", requireAuth, firmWorkspaceRoutes);
app.use("/api/campaigns", requireAuth, campaignCommandRoutes);
app.use("/api/mail", requireAuth, mailRoutes);
app.use("/api/platform", requireAuth, platformRoutes);
app.use("/api/intelligence", requireAuth, intelligenceRoutes);
app.use("/api/forecast", requireAuth, forecastRoutes);
app.use("/api/fec", requireAuth, fecRoutes);
app.use("/api/candidates", candidatesRoutes);
app.use("/api/vendors", vendorsRoutes);
app.use("/api/states", statesRoutes);
app.use("/api/donors", donorsRoutes);
app.use("/api/consultants", consultantsRoutes);
app.use("/api/mailops", mailOpsRoutes);
app.use("/api/public", publicRoutes);

app.post("/api/live/test/forecast", requireAuth, (req, res) => {
  const payload = {
    state: req.body?.state || "Arizona",
    office: req.body?.office || "Senate",
    winProbability: req.body?.winProbability ?? 54,
    change: req.body?.change || "+2.1",
  };

  publishEvent({
    type: "forecast.updated",
    channel: "intelligence:forecast",
    timestamp: new Date().toISOString(),
    payload,
  });

  res.status(200).json({ ok: true, published: payload });
});

app.post("/api/live/test/warroom", requireAuth, (req, res) => {
  const payload = {
    title:
      req.body?.title ||
      "Education narrative moving into mainstream local pickup",
    severity: req.body?.severity || "medium",
    source: req.body?.source || "Media monitoring",
    velocity: req.body?.velocity || "+21%",
    recommendation:
      req.body?.recommendation || "Push validator-driven local messaging.",
  };

  publishEvent({
    type: "warroom.threat_detected",
    channel: "intelligence:warroom",
    timestamp: new Date().toISOString(),
    payload,
  });

  res.status(200).json({ ok: true, published: payload });
});

app.post("/api/live/test/mail-delay", requireAuth, (req, res) => {
  const campaignId = req.body?.campaignId || 1;

  const payload = {
    campaignId,
    mailDropId: req.body?.mailDropId || 1,
    location: req.body?.location || "Atlanta NDC",
    status: "delayed",
    note: req.body?.note || "Mail delay detected by live intelligence layer",
  };

  publishEvent({
    type: "mail.delay_detected",
    channel: `campaign:${campaignId}`,
    timestamp: new Date().toISOString(),
    payload,
  });

  res.status(200).json({ ok: true, published: payload });
});

app.post("/api/live/test/billing", requireAuth, (req, res) => {
  const firmId = req.body?.firmId || 1;

  const payload = {
    firmId,
    planTier: req.body?.planTier || "pro",
    status: req.body?.status || "active",
  };

  publishEvent({
    type: "billing.plan_updated",
    channel: `firm:${firmId}`,
    timestamp: new Date().toISOString(),
    payload,
  });

  res.status(200).json({ ok: true, published: payload });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

app.use((err, _req, res, _next) => {
  console.error("API error:", err);

  const status =
    err?.status ||
    err?.statusCode ||
    (String(err?.message || "").includes("CORS blocked") ? 403 : 500);

  res.status(status).json({
    error: err?.message || "Internal server error",
  });
});

const server = http.createServer(app);

initSocket(server, ALLOWED_ORIGINS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ VoterSpheres backend listening on port ${PORT}`);
  console.log(`✅ Live intelligence layer enabled`);
});
