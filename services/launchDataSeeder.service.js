import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return { ok: true, rows: result.rows || [], error: "" };
  } catch (error) {
    console.warn("[launch-data-seeder] skipped:", error.message);
    return { ok: false, rows: [], error: error.message };
  }
}

function number(value = 0) {
  return Number(value || 0);
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS launch_seed_runs (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      status TEXT DEFAULT 'completed',
      summary JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS revenue_pipeline_deals (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      organization TEXT,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      state TEXT,
      party TEXT,
      office TEXT,
      source TEXT DEFAULT 'launch_seed',
      stage TEXT DEFAULT 'lead',
      value NUMERIC DEFAULT 0,
      probability INTEGER DEFAULT 10,
      expected_close_date DATE,
      next_step TEXT,
      notes TEXT,
      candidate_id INTEGER,
      crm_contact_id INTEGER,
      client_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

const STATES = ["LA", "GA", "PA", "AZ", "NV", "MI", "WI", "NC", "TX", "FL"];

const VENDORS = [
  ["Bayou Ballot Mail", "Direct Mail", "LA"],
  ["Pelican Print & Mail", "Direct Mail", "LA"],
  ["Peachtree Digital", "Digital", "GA"],
  ["Atlanta Media Exchange", "Media Buying", "GA"],
  ["Keystone Mail House", "Direct Mail", "PA"],
  ["Liberty Polling Group", "Polling", "PA"],
  ["Desert Data Labs", "Data", "AZ"],
  ["Copper State Digital", "Digital", "AZ"],
  ["Silver State Media", "Media Buying", "NV"],
  ["Nevada Field Works", "Field", "NV"],
  ["Great Lakes Strategy", "General Consulting", "MI"],
  ["Michigan Mail Partners", "Direct Mail", "MI"],
  ["Badger Analytics", "Polling", "WI"],
  ["Madison Digital Lab", "Digital", "WI"],
  ["Carolina Ground Game", "Field", "NC"],
  ["Raleigh Research Group", "Polling", "NC"],
  ["Lone Star Media", "Media Buying", "TX"],
  ["Texas Victory Mail", "Direct Mail", "TX"],
  ["Sunshine State Digital", "Digital", "FL"],
  ["Florida Field Network", "Field", "FL"],
  ["Capitol Creative", "Creative", "DC"],
  ["National Compliance Desk", "Compliance", "DC"],
  ["Victory Data Exchange", "Data", "VA"],
  ["Rapid Response Media", "Media Buying", "VA"],
  ["Strategic Mail Alliance", "Direct Mail", "MD"],
];

const TASKS = [
  ["LA Senate Mail Program", "Finalize direct mail production timeline and vendor capacity.", "LA", "high"],
  ["GA Fundraising Push", "Prepare donor outreach and top target list.", "GA", "high"],
  ["PA GOTV Planning", "Build GOTV operational map and field task owners.", "PA", "critical"],
  ["AZ Polling Analysis", "Review latest battleground polling movement.", "AZ", "high"],
  ["NV Vendor Procurement", "Identify backup mail and digital vendors.", "NV", "normal"],
  ["MI Narrative Response", "Draft rapid response messaging for new opposition hit.", "MI", "high"],
  ["WI Digital Audit", "Review digital spend efficiency and creative rotation.", "WI", "normal"],
  ["NC Field Deployment", "Confirm regional captains and county coverage.", "NC", "high"],
  ["TX Donor Outreach", "Build major donor call sheet.", "TX", "normal"],
  ["FL Opposition Research", "Prepare research memo and candidate vulnerability brief.", "FL", "high"],
  ["LA Compliance Review", "Audit active disclaimers and reporting deadlines.", "LA", "normal"],
  ["GA Vendor Coverage", "Score direct mail and media vendor gaps.", "GA", "normal"],
  ["PA County Escalation", "Review county-level risk signals.", "PA", "critical"],
  ["AZ Volunteer Funnel", "Create volunteer recruitment workflow.", "AZ", "normal"],
  ["NV Early Vote Watch", "Monitor early vote turnout signals.", "NV", "high"],
  ["MI Report Export", "Generate executive campaign report.", "MI", "normal"],
  ["WI Fundraising Snapshot", "Prepare finance update for consultant review.", "WI", "normal"],
  ["NC Media Buy Review", "Check media buyer inventory and rates.", "NC", "high"],
  ["TX CRM Follow-up", "Assign prospect follow-up from Opportunity Engine.", "TX", "normal"],
  ["FL Client Update", "Publish weekly client portal update.", "FL", "normal"],
];

const CRM = [
  ["Carter for Senate", "Campaign Manager", "LA", "Republican", "Senate"],
  ["Georgia Forward PAC", "Executive Director", "GA", "Democratic", "PAC"],
  ["Keystone Reform Committee", "Finance Director", "PA", "Independent", "Statewide"],
  ["Arizona Jobs Coalition", "Political Director", "AZ", "Republican", "Ballot Initiative"],
  ["Nevada Families First", "Campaign Chair", "NV", "Democratic", "State Senate"],
  ["Michigan Majority Fund", "Consultant", "MI", "Democratic", "House"],
  ["Wisconsin Growth PAC", "Treasurer", "WI", "Republican", "PAC"],
  ["Carolina Future Project", "Field Director", "NC", "Independent", "Local"],
  ["Texas Liberty Slate", "General Consultant", "TX", "Republican", "State House"],
  ["Florida Reform Alliance", "Communications Director", "FL", "Democratic", "Governor"],
  ["Citizens for Parish Growth", "Chair", "LA", "Independent", "Local"],
  ["Atlanta Leadership Fund", "Advisor", "GA", "Democratic", "Mayor"],
  ["Pennsylvania Main Street PAC", "Director", "PA", "Republican", "PAC"],
  ["Desert Schools Coalition", "Organizer", "AZ", "Independent", "School Board"],
  ["Silver State Opportunity", "Consultant", "NV", "Republican", "Congress"],
];

const CLIENTS = [
  ["Liberty Strategies", "active", "stable", 12000],
  ["Victory Campaign Group", "active", "watch", 18500],
  ["American Leadership PAC", "active", "stable", 25000],
  ["Citizens for Reform", "active", "at risk", 9500],
  ["Secure Borders Coalition", "active", "stable", 15000],
  ["Forward Counties Project", "active", "watch", 11000],
  ["Main Street Majority", "active", "stable", 13500],
  ["Capital Field Partners", "active", "stable", 17000],
  ["Statewide Victory Fund", "active", "watch", 22000],
  ["Future Leadership PAC", "active", "stable", 14000],
];

const NOTIFICATIONS = [
  ["Fundraising threshold reached", "high", "Finance alert for target campaign."],
  ["Vendor delay risk", "critical", "Direct mail production schedule needs review."],
  ["County escalation", "high", "County pressure score crossed threshold."],
  ["Polling shift detected", "medium", "Polling movement requires analysis."],
  ["Narrative alert", "high", "Rapid response needed on emerging issue."],
];

async function countTable(table, firmId = null) {
  const hasFirm = firmId !== null;
  const result = await safeQuery(
    `SELECT COUNT(*)::int AS count FROM ${table}${hasFirm ? " WHERE firm_id = $1" : ""}`,
    hasFirm ? [firmId] : []
  );
  return number(result.rows?.[0]?.count);
}

export async function getLaunchSeederStatus({ user = {} }) {
  await ensureTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const counts = {
    vendors: await countTable("vendors", firmId),
    tasks: await countTable("tasks", firmId),
    crm_contacts: await countTable("campaign_crm_contacts", firmId),
    notifications: await countTable("notification_events", firmId),
    clients: await countTable("consultant_clients", firmId),
    reports: await countTable("intelligence_reports", firmId),
    revenue_deals: await countTable("revenue_pipeline_deals", firmId),
    workspaces: await countTable("workspaces", firmId),
    candidates: await countTable("candidates"),
    fec_candidates: await countTable("fec_candidates"),
  };

  const targets = {
    vendors: 25,
    tasks: 20,
    crm_contacts: 25,
    notifications: 20,
    clients: 10,
    reports: 5,
    revenue_deals: 10,
    workspaces: 1,
  };

  const readinessRows = Object.entries(targets).map(([key, target]) => ({
    key,
    label: key.replace(/_/g, " "),
    count: counts[key] || 0,
    target,
    ready: number(counts[key]) >= target,
  }));

  const readiness_score = Math.round(
    (readinessRows.filter((row) => row.ready).length / readinessRows.length) * 100
  );

  const lastRun = await safeQuery(
    `
      SELECT *
      FROM launch_seed_runs
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [firmId]
  );

  return {
    summary: {
      readiness_score,
      ready_items: readinessRows.filter((row) => row.ready).length,
      total_items: readinessRows.length,
      needs_seed: readinessRows.filter((row) => !row.ready).length,
    },
    counts,
    targets,
    readiness: readinessRows,
    last_run: lastRun.rows?.[0] || null,
    updated_at: new Date().toISOString(),
  };
}

async function insertVendor(firmId, [name, category, state]) {
  await safeQuery(
    `
      INSERT INTO vendors (
        firm_id, name, category, state, status, contact_status, contact_confidence, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,'active','complete',85,NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM vendors WHERE firm_id = $1 AND LOWER(name) = LOWER($2)
      )
    `,
    [firmId, name, category, state]
  );
}

async function insertTask(firmId, [title, description, state, priority]) {
  await safeQuery(
    `
      INSERT INTO tasks (
        firm_id, title, description, state, priority, status, source, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,$5,'open','launch_seed',NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM tasks WHERE firm_id = $1 AND LOWER(title) = LOWER($2)
      )
    `,
    [firmId, title, description, state, priority]
  );
}

async function insertCrm(firmId, [name, role, state, party, office]) {
  await safeQuery(
    `
      INSERT INTO campaign_crm_contacts (
        firm_id, full_name, organization, role_type, state, notes, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,$5,$6,NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM campaign_crm_contacts WHERE firm_id = $1 AND LOWER(full_name) = LOWER($2)
      )
    `,
    [
      firmId,
      name,
      `${state} ${party} ${office}`,
      role,
      state,
      `Launch seed CRM record for ${party} ${office} opportunity.`,
    ]
  );
}

async function insertClient(firmId, [clientName, status, health, retainer]) {
  await safeQuery(
    `
      INSERT INTO consultant_clients (
        firm_id, client_name, status, health_status, monthly_retainer, notes, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,$5,'Launch seed client record.',NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM consultant_clients WHERE firm_id = $1 AND LOWER(client_name) = LOWER($2)
      )
    `,
    [firmId, clientName, status, health, retainer]
  );
}

async function insertNotification(firmId, [title, level, detail], index) {
  await safeQuery(
    `
      INSERT INTO notification_events (
        firm_id, title, level, message, source, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,'launch_seed',NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM notification_events WHERE firm_id = $1 AND LOWER(title) = LOWER($2)
      )
    `,
    [firmId, title, level, detail]
  );
}

async function insertReport(firmId, title, state = "National") {
  await safeQuery(
    `
      INSERT INTO intelligence_reports (
        firm_id, title, report_type, state, status, summary, created_at, updated_at
      )
      SELECT $1,$2,'Launch Demo',$3,'generated','Launch seed intelligence report.',NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM intelligence_reports WHERE firm_id = $1 AND LOWER(title) = LOWER($2)
      )
    `,
    [firmId, title, state]
  );
}

async function insertRevenueDeal(firmId, [name, role, state, party, office], index) {
  const value = 15000 + index * 2500;
  const stage = index % 4 === 0 ? "proposal" : index % 3 === 0 ? "qualified" : "prospect";
  const probability = stage === "proposal" ? 70 : stage === "qualified" ? 45 : 25;

  await safeQuery(
    `
      INSERT INTO revenue_pipeline_deals (
        firm_id, title, organization, contact_name, state, party, office, source, stage,
        value, probability, next_step, notes, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,'launch_seed',$8,$9,$10,$11,$12,NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM revenue_pipeline_deals WHERE firm_id = $1 AND LOWER(title) = LOWER($2)
      )
    `,
    [
      firmId,
      `${name} Consulting Opportunity`,
      name,
      name,
      state,
      party,
      office,
      stage,
      value,
      probability,
      "Assign consultant follow-up and prepare opportunity brief.",
      "Created by Launch Data Seeder.",
    ]
  );
}

async function insertWorkspace(firmId) {
  await safeQuery(
    `
      INSERT INTO workspaces (
        firm_id, name, state, office, cycle, status, created_at, updated_at
      )
      SELECT $1,'Launch Demo Workspace','National','Consultant Command','2026','active',NOW(),NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM workspaces WHERE firm_id = $1 AND LOWER(name) = LOWER('Launch Demo Workspace')
      )
    `,
    [firmId]
  );
}

export async function runLaunchDataSeeder({ user = {} }) {
  await ensureTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  for (const vendor of VENDORS) await insertVendor(firmId, vendor);
  for (const task of TASKS) await insertTask(firmId, task);
  for (const crm of CRM) await insertCrm(firmId, crm);
  for (const client of CLIENTS) await insertClient(firmId, client);
  for (let i = 0; i < NOTIFICATIONS.length; i += 1) await insertNotification(firmId, NOTIFICATIONS[i], i);
  for (let i = 0; i < CRM.length; i += 1) await insertRevenueDeal(firmId, CRM[i], i);
  await insertWorkspace(firmId);

  const reports = [
    ["Executive Launch Brief", "National"],
    ["Fundraising Snapshot", "National"],
    ["Political Signal Report", "GA"],
    ["Vendor Coverage Report", "PA"],
    ["Opportunity Pipeline Report", "AZ"],
  ];
  for (const [title, state] of reports) await insertReport(firmId, title, state);

  const status = await getLaunchSeederStatus({ user });

  await pool.query(
    `
      INSERT INTO launch_seed_runs (firm_id, status, summary, created_at)
      VALUES ($1, 'completed', $2::jsonb, NOW())
    `,
    [firmId, JSON.stringify(status.summary)]
  );

  return {
    message: "Launch demo data seeded successfully.",
    ...status,
  };
}
