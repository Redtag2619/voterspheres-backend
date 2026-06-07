import "dotenv/config";
import express from "express";   
import http from "http"; 
import cors from "cors";
import helmet from "helmet"; 
import morgan from "morgan"; 

import authRoutes from "./routes/auth.routes.js"; 
import billingRoutes from "./routes/billing.routes.js";  
import alertsRoutes from "./routes/alerts.routes.js";
import executiveAlertEngineRoutes from "./routes/executiveAlertEngine.routes.js";  
import operationsMapRoutes from "./routes/operationsMap.routes.js"; 
import realtimeRoutes from "./routes/realtime.routes.js";
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
import candidateProfilesRoutes from "./routes/candidateProfiles.routes.js";
import vendorsRoutes from "./routes/vendors.routes.js";
import statesRoutes from "./routes/states.routes.js";
import donorsRoutes from "./routes/donors.routes.js";
import consultantsRoutes from "./routes/consultants.routes.js";
import mailOpsRoutes from "./routes/mailops.routes.js";
import publicRoutes from "./routes/public.routes.js";
import publicInvitesRoutes from "./routes/publicInvites.routes.js";
import betaAdminRoutes from "./routes/betaAdmin.routes.js";
import firmUsersRoutes from "./routes/firmUsers.routes.js";
import firmInvitesRoutes from "./routes/firmInvites.routes.js";
import enterpriseLeadsAdminRoutes from "./routes/enterpriseLeadsAdmin.routes.js";
import tasksRoutes from "./routes/tasks.routes.js";
import workspacesRoutes from "./routes/workspaces.routes.js";
import workspaceContactsRoutes from "./routes/workspaceContacts.routes.js";
import scheduledReportsRoutes from "./routes/scheduledReports.routes.js";
import { startScheduledReportRunner } from "./services/scheduledReports.service.js";
import enterpriseLeadsRoutes from "./routes/enterpriseLeads.routes.js";
import workspaceOnboardingRoutes from "./routes/workspaceOnboarding.routes.js";
import { startCandidateEnrichmentScheduler } from "./services/candidateEnrichmentScheduler.service.js";
import consultantOpportunityRoutes from "./routes/consultantOpportunity.routes.js";
import relationshipGraphRoutes from "./routes/relationshipGraph.routes.js";
import consultantImportRoutes from "./routes/consultantImport.routes.js";
import consultantRiskRoutes from "./routes/consultantRisk.routes.js";
import { startConsultantImportJob } from "./jobs/consultantImport.job.js";
import consultantDeepIntelRoutes from "./routes/consultantDeepIntel.routes.js";
import consultantContactEnrichmentRoutes from "./routes/consultantContactEnrichment.routes.js"; 
import committeeIntelRoutes from "./routes/committeeIntel.routes.js";
import darkMoneyExposureRoutes from "./routes/darkMoneyExposure.routes.js";
import operationsRoutes from "./routes/operations.routes.js";
import workspaceIntelligenceRoutes from "./routes/workspaceIntelligence.routes.js";
import workspaceSignalFeedRoutes from "./routes/workspaceSignalFeed.routes.js";
import realtimeTacticalRoutes from "./routes/realtimeTactical.routes.js";
import workspaceOperatingRoomRoutes from "./routes/workspaceOperatingRoom.routes.js";
import aiTacticalIntelligenceRoutes from "./routes/aiTacticalIntelligence.routes.js";
import livePoliticalSignalsRoutes from "./routes/livePoliticalSignals.routes.js";
import newsNarrativeRoutes from "./routes/newsNarrative.routes.js";
import aiTacticalActionsRoutes from "./routes/aiTacticalActions.routes.js";
import narrativeRapidResponseRoutes from "./routes/narrativeRapidResponse.routes.js";
import taskOwnershipRoutes from "./routes/taskOwnership.routes.js";
import executiveMapSignalOverlayRoutes from "./routes/executiveMapSignalOverlay.routes.js";
import campaignWorkspaceCrmRoutes from "./routes/campaignWorkspaceCrm.routes.js";
import executiveMissionControlRoutes from "./routes/executiveMissionControl.routes.js";
import aiStrategicAdvisorRoutes from "./routes/aiStrategicAdvisor.routes.js";
import electionWarRoomRoutes from "./routes/electionWarRoom.routes.js";
import clientPortalRoutes from "./routes/clientPortal.routes.js";
import reportExportRoutes from "./routes/reportExport.routes.js";
import nationalElectionCommandCenterRoutes from "./routes/nationalElectionCommandCenter.routes.js";
import executiveRevenueRoutes from "./routes/executiveRevenue.routes.js";
import politicalIntelligenceRoutes from "./routes/politicalIntelligence.routes.js";
import notificationCenterRoutes from "./routes/notificationCenter.routes.js";
import executiveWorkspaceRoutes from "./routes/executiveWorkspace.routes.js";
import aiCampaignCopilotRoutes from "./routes/aiCampaignCopilot.routes.js";

import { requireAuth } from "./middleware/auth.middleware.js";
import { initSocket } from "./lib/socket.js";
import { publishEvent } from "./lib/intelligence.events.js";
import { handleStripeWebhook } from "./services/billing.service.js";
import { runLiveIntelligenceRefresh } from "./services/intelligenceRefresh.service.js";
import signalWorkspaceMatchingRoutes from "./routes/signalWorkspaceMatching.routes.js";
import consultantBusinessSuiteRoutes from "./routes/consultantBusinessSuite.routes.js";
import intelligenceReportsRoutes from "./routes/intelligenceReports.routes.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);

const ALLOWED_ORIGINS = [
  "https://voterspheres.org",
  "https://www.voterspheres.org",
  "https://voterspheres-frontend.vercel.app",
  "https://voterspheres-frontend-git-main-mark-j-stephens-projects.vercel.app",
  "https://voterspheres-frontend-os73qaqvn-mark-j-stephens-projects.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_APP_URL,
  process.env.VERCEL_FRONTEND_URL
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin.includes("vercel.app")) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
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
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"]
  })
);

app.options("*", cors());

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["stripe-signature"];

      if (!signature) {
        return res.status(400).json({
          error: "Missing stripe-signature header"
        });
      }

      const result = await handleStripeWebhook({
        rawBody: req.body,
        signature
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error("Stripe webhook error:", error);
      return res.status(400).json({
        error: error.message || "Webhook failed"
      });
    }
  }
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
    port: PORT
  });
});

app.get("/api", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "VoterSpheres API",
    live_intelligence: true
  });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/public", publicInvitesRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/enterprise-leads", enterpriseLeadsRoutes);
app.use("/api/public/enterprise-leads", enterpriseLeadsRoutes); 
app.use("/api/workspace-onboarding", workspaceOnboardingRoutes);

app.use("/api/alerts", requireAuth, alertsRoutes);
app.use("/api/executive-alerts", requireAuth, executiveAlertEngineRoutes);
app.use("/api/operations-map", requireAuth, operationsMapRoutes);
app.use("/api/realtime", requireAuth, realtimeRoutes);
app.use("/api/crm", requireAuth, crmRoutes);
app.use("/api/crm-dashboard", requireAuth, crmDashboardRoutes);
app.use("/api/firms", requireAuth, firmWorkspaceRoutes);
app.use("/api/campaigns", requireAuth, campaignCommandRoutes);
app.use("/api/mail", requireAuth, mailRoutes);
app.use("/api/platform", requireAuth, platformRoutes);
app.use("/api/intelligence", requireAuth, intelligenceRoutes);
app.use("/api/forecast", requireAuth, forecastRoutes);
app.use("/api/fec", requireAuth, fecRoutes);
app.use("/api/candidates", requireAuth, candidatesRoutes);
app.use("/api/candidate-profiles", requireAuth, candidateProfilesRoutes);
app.use("/api/states", requireAuth, statesRoutes);
app.use("/api/donors", requireAuth, donorsRoutes);
app.use("/api/consultant-opportunities", requireAuth, consultantOpportunityRoutes);
app.use("/api/mailops", requireAuth, mailOpsRoutes);
app.use("/api/vendors", vendorsRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/operations", operationsRoutes);
app.use("/api/workspaces", requireAuth, workspacesRoutes);
app.use("/api/workspace-contacts", requireAuth, workspaceContactsRoutes);
app.use("/api/scheduled-reports", requireAuth, scheduledReportsRoutes);
app.use("/api/relationships", relationshipGraphRoutes);
app.use("/api/consultants/import", requireAuth, consultantImportRoutes);
app.use("/api/consultants/risk", requireAuth, consultantRiskRoutes);
app.use("/api/consultants/deep-intel", requireAuth, consultantDeepIntelRoutes);
app.use("/api/consultants/contact-enrichment", requireAuth, consultantContactEnrichmentRoutes);
app.use("/api/committees", requireAuth, committeeIntelRoutes);
app.use("/api/dark-money-exposure", requireAuth, darkMoneyExposureRoutes);
app.use("/api/consultants", requireAuth, consultantsRoutes);
app.use("/api/workspace-intelligence", workspaceIntelligenceRoutes);
app.use("/api/workspace-signal-feed", workspaceSignalFeedRoutes);
app.use("/api/realtime-tactical", realtimeTacticalRoutes);
app.use("/api/workspace-operating-room", workspaceOperatingRoomRoutes);
app.use("/api/ai-tactical", aiTacticalIntelligenceRoutes);
app.use("/api/political-signals", livePoliticalSignalsRoutes);
app.use("/api/signal-workspace-matching", signalWorkspaceMatchingRoutes);
app.use("/api/news-narrative", newsNarrativeRoutes);
app.use("/api/ai-tactical/actions", aiTacticalActionsRoutes);
app.use("/api/narrative-rapid-response", narrativeRapidResponseRoutes);
app.use("/api/executive-map-signal-overlay", executiveMapSignalOverlayRoutes);
app.use("/api/task-ownership", taskOwnershipRoutes);
app.use("/api/campaign-crm", campaignWorkspaceCrmRoutes);
app.use("/api/executive-mission-control", executiveMissionControlRoutes);
app.use("/api/intelligence-reports", intelligenceReportsRoutes);
app.use("/api/ai-strategic-advisor", aiStrategicAdvisorRoutes);
app.use("/api/election-war-room", electionWarRoomRoutes);
app.use("/api/client-portal", clientPortalRoutes);
app.use("/api/report-exports", reportExportRoutes);
app.use("/api/national-election-command-center", nationalElectionCommandCenterRoutes);
app.use("/api/consultant-business-suite", consultantBusinessSuiteRoutes);
app.use("/api/executive-revenue", executiveRevenueRoutes);
app.use("/api/political-intelligence", politicalIntelligenceRoutes);
app.use("/api/notifications", notificationCenterRoutes);
app.use("/api/executive-workspace", executiveWorkspaceRoutes);
app.use("/api/ai-campaign-copilot", aiCampaignCopilotRoutes);

app.use("/api/beta-admin", requireAuth, betaAdminRoutes);
app.use("/api/firm-users", requireAuth, firmUsersRoutes);
app.use("/api/firm-invites", requireAuth, firmInvitesRoutes);
app.use("/api/enterprise-leads-admin", requireAuth, enterpriseLeadsAdminRoutes);

app.post("/api/live/test/forecast", requireAuth, (req, res) => {
  const payload = {
    state: req.body?.state || "Arizona",
    office: req.body?.office || "Senate",
    winProbability: req.body?.winProbability ?? 54,
    change: req.body?.change || "+2.1"
  };

  publishEvent({
    type: "forecast.updated",
    channel: "intelligence:forecast",
    timestamp: new Date().toISOString(),
    payload
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
      req.body?.recommendation || "Push validator-driven local messaging."
  };

  publishEvent({
    type: "warroom.threat_detected",
    channel: "intelligence:warroom",
    timestamp: new Date().toISOString(),
    payload
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
    note: req.body?.note || "Mail delay detected by live intelligence layer"
  };

  publishEvent({
    type: "mail.delay_detected",
    channel: `campaign:${campaignId}`,
    timestamp: new Date().toISOString(),
    payload
  });

  res.status(200).json({ ok: true, published: payload });
});

app.post("/api/live/test/billing", requireAuth, (req, res) => {
  const firmId = req.body?.firmId || 1;

  const payload = {
    firmId,
    planTier: req.body?.planTier || "pro",
    status: req.body?.status || "active"
  };

  publishEvent({
    type: "billing.plan_updated",
    channel: `firm:${firmId}`,
    timestamp: new Date().toISOString(),
    payload
  });

  res.status(200).json({ ok: true, published: payload });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl
  });
});

app.use((err, _req, res, _next) => {
  console.error("API error:", err);

  const status =
    err?.status ||
    err?.statusCode ||
    (String(err?.message || "").includes("CORS blocked") ? 403 : 500);

  res.status(status).json({
    error: err?.message || "Internal server error"
  });
});

const server = http.createServer(app);

initSocket(server, ALLOWED_ORIGINS);

const LIVE_REFRESH_ENABLED =
  String(process.env.LIVE_REFRESH_ENABLED || "false").toLowerCase() === "true";

const LIVE_REFRESH_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.LIVE_REFRESH_INTERVAL_MS || 4 * 60 * 60 * 1000)
);

async function runScheduledIntelligenceRefresh(trigger = "startup") {
  try {
    const result = await runLiveIntelligenceRefresh();

    console.log(`✅ Live intelligence refresh complete (${trigger})`, {
      feed_inserted: result?.executive_feed?.inserted,
      alerts_sent: result?.alerts?.sent,
      alerts_failed: result?.alerts?.failed,
      news_seen: result?.news?.seen,
      polling_seen: result?.polling?.seen
    });
  } catch (error) {
    if (
  error?.response?.status === 402 ||
  String(error?.message || "").includes("402")
) {
  console.warn(
    `⚠️ Live intelligence refresh skipped (${trigger}) — plan gated`
  );
  return;
}

console.error(
  `❌ Live intelligence refresh failed (${trigger})`,
  error.message
);
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ VoterSpheres backend listening on port ${PORT}`);
  console.log("✅ Live intelligence layer enabled");
  console.log("✅ Stripe webhook mounted at /api/billing/webhook");

  if (LIVE_REFRESH_ENABLED) {
    runScheduledIntelligenceRefresh("startup");
    setInterval(() => {
      runScheduledIntelligenceRefresh("interval");
    }, LIVE_REFRESH_INTERVAL_MS);
  }

  startScheduledReportRunner();
  startCandidateEnrichmentScheduler();
  startConsultantImportJob();
}); 


