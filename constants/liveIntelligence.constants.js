export const READINESS_COMPONENT_WEIGHTS = Object.freeze({
  connectivity: 25,
  freshness: 30,
  coverage: 25,
  quality: 20,
});

export const DOMAIN_CONFIG = Object.freeze({
  political_intelligence: {
    label: "Political Intelligence",
    description:
      "Candidates, election intelligence, forecasts, coalitions, and political signals.",
    weight: 25,
  },
  campaign_operations: {
    label: "Campaign Operations",
    description:
      "Tasks, operational plans, execution boards, and field readiness.",
    weight: 20,
  },
  crm_audience: {
    label: "CRM & Audience",
    description:
      "Contacts, organizations, engagement, and stakeholder coverage.",
    weight: 15,
  },
  finance_compliance: {
    label: "Finance & FEC",
    description:
      "FEC records, fundraising, subscriptions, billing, and revenue events.",
    weight: 15,
  },
  vendors_execution: {
    label: "Vendors & Execution",
    description:
      "Vendor coverage, assignments, fulfillment, and execution capacity.",
    weight: 10,
  },
  platform_infrastructure: {
    label: "Platform Infrastructure",
    description:
      "Workspaces, users, authentication, alerts, reports, and platform health.",
    weight: 15,
  },
});

export const FEED_CONFIG = Object.freeze([
  {
    key: "candidates",
    label: "Candidates",
    description: "Candidate records and profile coverage.",
    domain: "political_intelligence",
    criticality: "core",
    requiredForLaunch: true,
    weight: 28,
    tables: ["candidates"],
    timestampColumns: ["updated_at", "last_synced_at", "created_at"],
    targetCount: 50,
    freshnessThresholdHours: 24,
    staleThresholdHours: 72,
    owner: "Political Data",
    route: "/candidates",
    remediation:
      "Run the candidate synchronization and verify that production candidate profiles are populated.",
  },
  {
    key: "fec",
    label: "FEC & Fundraising",
    description:
      "Federal filing, committee, contribution, and fundraising records.",
    domain: "finance_compliance",
    criticality: "core",
    requiredForLaunch: true,
    weight: 34,
    tables: ["fec_filings", "fec_contributions", "contributions"],
    timestampColumns: [
      "updated_at",
      "last_synced_at",
      "filed_at",
      "created_at",
    ],
    targetCount: 500,
    freshnessThresholdHours: 36,
    staleThresholdHours: 96,
    owner: "Finance Intelligence",
    route: "/fundraising",
    remediation:
      "Run the FEC synchronization, validate API credentials, and confirm recent filing records.",
  },
  {
    key: "signals",
    label: "Political Signals",
    description:
      "Live political, media, coalition, and influence signals.",
    domain: "political_intelligence",
    criticality: "core",
    requiredForLaunch: true,
    weight: 30,
    tables: ["political_signals", "intelligence_signals", "signals"],
    timestampColumns: ["observed_at", "updated_at", "created_at"],
    targetCount: 25,
    freshnessThresholdHours: 6,
    staleThresholdHours: 24,
    owner: "Intelligence Operations",
    route: "/intelligence",
    remediation:
      "Reconnect signal ingestion and confirm that current political events are being captured.",
  },
  {
    key: "forecasts",
    label: "Forecast Intelligence",
    description:
      "Election forecasts, scenario outputs, and confidence updates.",
    domain: "political_intelligence",
    criticality: "important",
    requiredForLaunch: true,
    weight: 14,
    tables: ["election_forecasts", "forecast_runs", "forecasts"],
    timestampColumns: ["generated_at", "updated_at", "created_at"],
    targetCount: 10,
    freshnessThresholdHours: 24,
    staleThresholdHours: 72,
    owner: "Decision Intelligence",
    route: "/executive-forecast",
    remediation:
      "Generate a current forecast run and confirm that modeled races are attached to production candidates.",
  },
  {
    key: "tasks",
    label: "Execution Tasks",
    description:
      "Campaign tasks, assignments, status changes, and due dates.",
    domain: "campaign_operations",
    criticality: "core",
    requiredForLaunch: true,
    weight: 38,
    tables: ["tasks"],
    timestampColumns: ["updated_at", "completed_at", "created_at"],
    targetCount: 15,
    freshnessThresholdHours: 6,
    staleThresholdHours: 48,
    owner: "Campaign Operations",
    route: "/tasks",
    remediation:
      "Create production execution tasks, assign owners, and confirm status updates are flowing.",
  },
  {
    key: "operations",
    label: "State & Local Operations",
    description:
      "State, county, parish, and locality operating records.",
    domain: "campaign_operations",
    criticality: "important",
    requiredForLaunch: true,
    weight: 34,
    tables: ["state_localities", "state_operations", "operations"],
    timestampColumns: ["updated_at", "created_at"],
    targetCount: 100,
    freshnessThresholdHours: 720,
    staleThresholdHours: 2160,
    owner: "National Operations",
    route: "/state-operations",
    remediation:
      "Verify state-locality coverage and import missing county or parish records.",
  },
  {
    key: "crm_contacts",
    label: "CRM Contacts",
    description:
      "Contact records, organizations, and relationship intelligence.",
    domain: "crm_audience",
    criticality: "core",
    requiredForLaunch: true,
    weight: 62,
    tables: ["crm_contacts", "contacts"],
    timestampColumns: ["updated_at", "last_contacted_at", "created_at"],
    targetCount: 100,
    freshnessThresholdHours: 24,
    staleThresholdHours: 168,
    owner: "CRM Operations",
    route: "/crm",
    remediation:
      "Import production contacts, remove invalid records, and confirm contact ownership.",
  },
  {
    key: "crm_organizations",
    label: "CRM Organizations",
    description:
      "Organizations, committees, partners, and stakeholder entities.",
    domain: "crm_audience",
    criticality: "important",
    requiredForLaunch: false,
    weight: 38,
    tables: ["crm_organizations", "organizations"],
    timestampColumns: ["updated_at", "created_at"],
    targetCount: 25,
    freshnessThresholdHours: 72,
    staleThresholdHours: 336,
    owner: "CRM Operations",
    route: "/crm",
    remediation:
      "Import organization records and link contacts to their organizations.",
  },
  {
    key: "vendors",
    label: "Vendor Network",
    description:
      "Vendor profiles, state coverage, categories, and execution readiness.",
    domain: "vendors_execution",
    criticality: "important",
    requiredForLaunch: true,
    weight: 65,
    tables: ["vendors"],
    timestampColumns: ["updated_at", "created_at"],
    targetCount: 25,
    freshnessThresholdHours: 168,
    staleThresholdHours: 720,
    owner: "Vendor Operations",
    route: "/vendors",
    remediation:
      "Populate vendor coverage, categories, service areas, and production readiness fields.",
  },
  {
    key: "vendor_assignments",
    label: "Vendor Assignments",
    description:
      "Assignments connecting vendors to execution tasks and target states.",
    domain: "vendors_execution",
    criticality: "supporting",
    requiredForLaunch: false,
    weight: 35,
    tables: ["vendor_assignments", "task_vendors"],
    timestampColumns: ["updated_at", "created_at"],
    targetCount: 5,
    freshnessThresholdHours: 24,
    staleThresholdHours: 168,
    owner: "Vendor Operations",
    route: "/command-center",
    remediation:
      "Assign vendors to open execution tasks and verify task-state coverage.",
  },
  {
    key: "workspaces",
    label: "Enterprise Workspaces",
    description:
      "Workspace records, membership, and operating context.",
    domain: "platform_infrastructure",
    criticality: "core",
    requiredForLaunch: true,
    weight: 28,
    tables: ["workspaces"],
    timestampColumns: ["updated_at", "created_at"],
    targetCount: 1,
    freshnessThresholdHours: 720,
    staleThresholdHours: 2160,
    owner: "Platform Operations",
    route: "/executive-workspace",
    remediation:
      "Create the production workspace and verify administrator membership and permissions.",
  },
  {
    key: "users",
    label: "Users & Access",
    description:
      "Authenticated users, roles, and account activity.",
    domain: "platform_infrastructure",
    criticality: "core",
    requiredForLaunch: true,
    weight: 24,
    tables: ["users"],
    timestampColumns: ["last_login_at", "updated_at", "created_at"],
    targetCount: 2,
    freshnessThresholdHours: 168,
    staleThresholdHours: 720,
    owner: "Platform Operations",
    route: "/executive-workspace",
    remediation:
      "Verify production users, roles, workspace membership, and successful authentication.",
  },
  {
    key: "alerts",
    label: "Alerts",
    description:
      "Operational and intelligence alerts delivered to users.",
    domain: "platform_infrastructure",
    criticality: "important",
    requiredForLaunch: true,
    weight: 18,
    tables: ["alerts", "notifications"],
    timestampColumns: ["created_at", "updated_at", "sent_at"],
    targetCount: 5,
    freshnessThresholdHours: 12,
    staleThresholdHours: 72,
    owner: "Platform Operations",
    route: "/alerts",
    remediation:
      "Generate and deliver a production alert, then verify recipient routing and acknowledgement.",
  },
  {
    key: "reports",
    label: "Reports",
    description:
      "Generated executive, campaign, and operational reports.",
    domain: "platform_infrastructure",
    criticality: "supporting",
    requiredForLaunch: false,
    weight: 12,
    tables: ["reports", "generated_reports"],
    timestampColumns: ["generated_at", "updated_at", "created_at"],
    targetCount: 3,
    freshnessThresholdHours: 72,
    staleThresholdHours: 336,
    owner: "Executive Reporting",
    route: "/reports",
    remediation:
      "Generate current executive and operational reports from production data.",
  },
  {
    key: "billing",
    label: "Billing & Revenue",
    description:
      "Subscriptions, billing state, and revenue events.",
    domain: "finance_compliance",
    criticality: "important",
    requiredForLaunch: true,
    weight: 40,
    tables: ["subscriptions", "billing_customers", "payments"],
    timestampColumns: [
      "updated_at",
      "created_at",
      "current_period_end",
    ],
    targetCount: 1,
    freshnessThresholdHours: 24,
    staleThresholdHours: 168,
    owner: "Revenue Operations",
    route: "/billing",
    remediation:
      "Connect the production billing account and verify subscription and webhook events.",
  },
  {
    key: "fundraising",
    label: "Fundraising Activity",
    description:
      "Fundraising goals, transactions, and campaign performance.",
    domain: "finance_compliance",
    criticality: "important",
    requiredForLaunch: false,
    weight: 26,
    tables: [
      "fundraising_transactions",
      "donations",
      "contributions",
    ],
    timestampColumns: [
      "received_at",
      "updated_at",
      "created_at",
    ],
    targetCount: 10,
    freshnessThresholdHours: 24,
    staleThresholdHours: 168,
    owner: "Finance Intelligence",
    route: "/fundraising",
    remediation:
      "Import current fundraising activity and validate campaign totals.",
  },
]);

export const SCORING_RULES = Object.freeze([
  {
    key: "connectivity",
    label: "Connectivity",
    weight: READINESS_COMPONENT_WEIGHTS.connectivity,
    detail:
      "Source table or service is reachable and can be queried.",
  },
  {
    key: "freshness",
    label: "Freshness",
    weight: READINESS_COMPONENT_WEIGHTS.freshness,
    detail:
      "Source is within its feed-specific freshness threshold.",
  },
  {
    key: "coverage",
    label: "Coverage",
    weight: READINESS_COMPONENT_WEIGHTS.coverage,
    detail:
      "Source meets the expected minimum production record volume.",
  },
  {
    key: "quality",
    label: "Quality",
    weight: READINESS_COMPONENT_WEIGHTS.quality,
    detail:
      "Records are valid, complete, and free from detected duplicates.",
  },
]);
