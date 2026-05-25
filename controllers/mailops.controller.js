import { pool } from "../db/pool.js";
import { publishEvent } from "../lib/intelligence.events.js";
import { publishRealtimeEvent } from "../lib/realtime.bus.js";

const USPS_POLITICAL_MAIL_ALERT_URL =
  "https://tools.usps.com/political-mail-alert.htm";

const USPS_POLITICAL_MAIL_ISSUE_URL =
  "https://tools.usps.com/political-mail-issue.htm";

const USPS_INFORMED_DELIVERY_CAMPAIGN_URL =
  "https://id.usps.com/rminMailerPortal/pages/secure/dashboard.action";

function text(value = "") {
  return String(value || "").trim();
}

function nullable(value) {
  const next = text(value);
  return next ? next : null;
}

function normalizeSeverity(value) {
  const severity = text(value || "Medium");
  return ["Low", "Medium", "High", "Critical"].includes(severity)
    ? severity
    : "Medium";
}

function normalizeMailClass(value) {
  const next = text(value || "Marketing Mail");
  return ["Marketing Mail", "First-Class Mail"].includes(next)
    ? next
    : "Marketing Mail";
}

function normalizeMailFormat(value) {
  const next = text(value || "Letter");
  return ["Letter", "Flat"].includes(next) ? next : "Letter";
}

function normalizeStatus(value) {
  const status = text(value || "Pending");

  return [
    "Pending",
    "Scheduled",
    "At Printer",
    "At Mailshop",
    "Entered USPS",
    "In Transit",
    "Arrived SCF",
    "On Track",
    "Elevated",
    "Delivered",
    "Delayed",
    "Issue Opened",
    "Resolved",
  ].includes(status)
    ? status
    : "Pending";
}

function normalizeEventType(value) {
  const eventType = text(value || "mail_update");

  return [
    "mail_update",
    "job_created",
    "drop_created",
    "print_vendor_update",
    "entered_usps",
    "scan_update",
    "scf_arrival",
    "delay_alert",
    "delivery_update",
    "vendor_update",
    "issue_opened",
    "issue_resolved",
    "snailworks_import",
    "usps_ivmtr_import",
    "informed_delivery_campaign",
  ].includes(eventType)
    ? eventType
    : "mail_update";
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function dateOrNull(value) {
  return value ? value : null;
}

function calculateRisk(row = {}) {
  const status = String(row.status || "").toLowerCase();
  const severity = String(row.severity || "").toLowerCase();

  const expected = row.expected_scf_arrival_date
    ? new Date(row.expected_scf_arrival_date)
    : null;

  const now = new Date();
  const missedScf =
    expected &&
    !Number.isNaN(expected.getTime()) &&
    expected < now &&
    !row.actual_scf_arrival_date;

  if (severity === "critical" || status === "delayed" || missedScf) {
    return "High";
  }

  if (severity === "high" || ["elevated", "issue opened"].includes(status)) {
    return "Elevated";
  }

  if (["in transit", "entered usps", "arrived scf"].includes(status)) {
    return "Watch";
  }

  return "Stable";
}

function shouldAlert(event) {
  const status = String(event.status || "").toLowerCase();
  const severity = String(event.severity || "").toLowerCase();
  const deliveryRisk = String(event.delivery_risk || "").toLowerCase();

  return (
    ["elevated", "delayed", "issue opened"].includes(status) ||
    ["high", "critical"].includes(severity) ||
    ["high", "elevated"].includes(deliveryRisk)
  );
}

function buildRealtimePayload(event) {
  return {
    event,
    alert: shouldAlert(event)
      ? {
          id: event.id,
          title: `${event.campaign || "MailOps"} • ${
            event.location || event.scf || "Operational update"
          }`,
          severity: event.severity || "Medium",
          source: "MailOps Intelligence",
          detail:
            event.note ||
            event.notes ||
            `${event.event_type || "mail_update"} updated`,
          state: event.state,
          office: event.office,
          risk: event.delivery_risk || event.risk,
          job_number: event.job_number,
          print_vendor: event.print_vendor || event.vendor_name,
          political_mail_alert_confirmation:
            event.political_mail_alert_confirmation,
          political_mail_issue_confirmation:
            event.political_mail_issue_confirmation,
        }
      : null,
  };
}

function publishMailOps(type, event) {
  const payload = buildRealtimePayload(event);

  try {
    publishEvent({
      type,
      channel: "intelligence:mailops",
      timestamp: new Date().toISOString(),
      payload,
    });
  } catch (error) {
    console.error("MailOps publishEvent warning:", error.message);
  }

  try {
    publishRealtimeEvent({
      type,
      channel: "intelligence:mailops",
      timestamp: new Date().toISOString(),
      payload,
    });
  } catch (error) {
    console.error("MailOps realtime publish warning:", error.message);
  }
}

async function ensureMailOpsEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailops_events (
      id SERIAL PRIMARY KEY,
      campaign TEXT,
      state TEXT,
      office TEXT,
      risk TEXT,
      location TEXT,
      vendor_name TEXT,
      event_type TEXT DEFAULT 'mail_update',
      status TEXT DEFAULT 'Pending',
      severity TEXT DEFAULT 'Medium',
      event_time TIMESTAMP DEFAULT NOW(),
      in_home DATE,
      note TEXT,
      created_by_user_id INTEGER,
      firm_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const columns = [
    ["campaign", "TEXT"],
    ["state", "TEXT"],
    ["office", "TEXT"],
    ["risk", "TEXT"],
    ["location", "TEXT"],
    ["vendor_name", "TEXT"],
    ["event_type", "TEXT DEFAULT 'mail_update'"],
    ["status", "TEXT DEFAULT 'Pending'"],
    ["severity", "TEXT DEFAULT 'Medium'"],
    ["event_time", "TIMESTAMP DEFAULT NOW()"],
    ["in_home", "DATE"],
    ["note", "TEXT"],
    ["created_by_user_id", "INTEGER"],
    ["firm_id", "INTEGER"],
    ["created_at", "TIMESTAMP DEFAULT NOW()"],
    ["updated_at", "TIMESTAMP DEFAULT NOW()"],

    ["job_number", "TEXT"],
    ["assigned_to", "TEXT"],
    ["date_submitted", "DATE"],
    ["print_vendor", "TEXT"],
    ["mail_class", "TEXT"],
    ["mail_format", "TEXT"],
    ["quantity", "INTEGER"],
    ["pieces_mailed", "INTEGER"],
    ["postage_statement_id", "TEXT"],
    ["permit_number", "TEXT"],
    ["crid", "TEXT"],
    ["mid", "TEXT"],
    ["imb_mid", "TEXT"],
    ["imb_serial_range", "TEXT"],
    ["usps_job_id", "TEXT"],
    ["usps_status", "TEXT"],
    ["usps_last_scan_date", "TIMESTAMP"],
    ["usps_last_scan_facility", "TEXT"],
    ["usps_last_scan_city", "TEXT"],
    ["usps_last_scan_state", "TEXT"],
    ["expected_scf_arrival_date", "DATE"],
    ["actual_scf_arrival_date", "DATE"],
    ["scf", "TEXT"],
    ["scf_address", "TEXT"],
    ["ndc", "TEXT"],
    ["ndc_address", "TEXT"],
    ["estimated_in_home_date", "DATE"],
    ["actual_in_home_date", "DATE"],
    ["delivery_risk", "TEXT"],
    ["snailworks_job_id", "TEXT"],
    ["snailworks_campaign_id", "TEXT"],
    ["snailworks_status", "TEXT"],
    ["snailworks_last_sync_at", "TIMESTAMP"],
    ["tracking_source", "TEXT"],
    ["issue_status", "TEXT"],
    ["issue_notes", "TEXT"],

    ["political_mail_alert_confirmation", "TEXT"],
    ["political_mail_issue_confirmation", "TEXT"],
    ["informed_delivery_campaign_name", "TEXT"],
    ["informed_delivery_campaign_id", "TEXT"],
    ["informed_delivery_campaign_url", "TEXT"],

    ["mail_piece_file_name", "TEXT"],
    ["mail_piece_url", "TEXT"],
    ["ps_form_3602_file_name", "TEXT"],
    ["ps_form_3602_url", "TEXT"],
    ["ps_form_8125_file_name", "TEXT"],
    ["ps_form_8125_url", "TEXT"],
  ];

  for (const [name, type] of columns) {
    await pool.query(
      `ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS ${name} ${type}`
    );
  }

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_state ON mailops_events(state)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_office ON mailops_events(office)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_risk ON mailops_events(risk)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_time ON mailops_events(event_time DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_job_number ON mailops_events(job_number)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_scf ON mailops_events(scf)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_ndc ON mailops_events(ndc)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailops_events_print_vendor ON mailops_events(print_vendor)`
  );
}

async function seedMailOpsEventsIfEmpty() {
  await ensureMailOpsEventsTable();

  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM mailops_events`
  );

  if (Number(count.rows[0]?.total || 0) > 0) return;

  await pool.query(`
    INSERT INTO mailops_events (
      campaign, state, office, risk, location, vendor_name,
      event_type, status, severity, event_time, in_home, note,
      job_number, assigned_to, date_submitted, print_vendor, mail_class,
      mail_format, quantity, pieces_mailed, postage_statement_id,
      permit_number, crid, mid, imb_mid, imb_serial_range,
      usps_status, usps_last_scan_facility, expected_scf_arrival_date,
      actual_scf_arrival_date, scf, scf_address, ndc, ndc_address,
      estimated_in_home_date, delivery_risk, tracking_source,
      political_mail_alert_confirmation,
      political_mail_issue_confirmation,
      informed_delivery_campaign_name,
      informed_delivery_campaign_url
    )
    VALUES
      (
        'GA Senate Victory',
        'GA',
        'Senate',
        'Elevated',
        'Atlanta NDC',
        'Precision Mail Group',
        'delay_alert',
        'Elevated',
        'High',
        NOW(),
        CURRENT_DATE + INTERVAL '3 days',
        'Weekend backlog building. Watch clearance volume and scan latency.',
        'GA-2026-001',
        'MailOps Lead',
        CURRENT_DATE - INTERVAL '2 days',
        'Precision Mail Group',
        'Marketing Mail',
        'Letter',
        45000,
        45000,
        'PS-ATL-1001',
        'PERMIT-44',
        'CRID-10001',
        'MID-90210',
        '90210',
        '000001-045000',
        'Scan Delay',
        'Atlanta NDC',
        CURRENT_DATE,
        NULL,
        'Atlanta SCF',
        '1605 Boggs Rd NW, Duluth, GA 30096',
        'Atlanta NDC',
        '1800 James Jackson Pkwy NW, Atlanta, GA 30369',
        CURRENT_DATE + INTERVAL '3 days',
        'High',
        'manual',
        NULL,
        NULL,
        'GA Senate Victory ID Campaign',
        '${USPS_INFORMED_DELIVERY_CAMPAIGN_URL}'
      ),
      (
        'PA Governor Push',
        'PA',
        'Governor',
        'Watch',
        'Philadelphia P&DC',
        'Keystone Mail',
        'scan_update',
        'On Track',
        'Medium',
        NOW(),
        CURRENT_DATE + INTERVAL '5 days',
        'Scan recovery improving and vendor scan performance stable.',
        'PA-2026-004',
        'Production Desk',
        CURRENT_DATE - INTERVAL '1 day',
        'Keystone Mail',
        'First-Class Mail',
        'Flat',
        72500,
        72500,
        'PS-PHL-2044',
        'PERMIT-82',
        'CRID-20002',
        'MID-80421',
        '80421',
        '000001-072500',
        'In Transit',
        'Philadelphia P&DC',
        CURRENT_DATE + INTERVAL '1 day',
        NULL,
        'Philadelphia SCF',
        '7500 Lindbergh Blvd, Philadelphia, PA 19176',
        'Philadelphia NDC',
        '1900 Byberry Rd, Philadelphia, PA 19116',
        CURRENT_DATE + INTERVAL '5 days',
        'Watch',
        'manual',
        NULL,
        NULL,
        'PA Governor Push ID Campaign',
        '${USPS_INFORMED_DELIVERY_CAMPAIGN_URL}'
      )
  `);
}

function buildWhere(query = {}) {
  const values = [];
  const conditions = [];

  const filterMap = {
    state: "state",
    office: "office",
    risk: "risk",
    status: "status",
    event_type: "event_type",
    job_number: "job_number",
    assigned_to: "assigned_to",
    print_vendor: "print_vendor",
    scf: "scf",
    ndc: "ndc",
    tracking_source: "tracking_source",
  };

  for (const [inputKey, column] of Object.entries(filterMap)) {
    if (query[inputKey]) {
      values.push(text(query[inputKey]));
      conditions.push(`${column} = $${values.length}`);
    }
  }

  if (query.search) {
    values.push(`%${text(query.search)}%`);
    conditions.push(`(
      campaign ILIKE $${values.length}
      OR job_number ILIKE $${values.length}
      OR print_vendor ILIKE $${values.length}
      OR assigned_to ILIKE $${values.length}
      OR location ILIKE $${values.length}
      OR scf ILIKE $${values.length}
      OR ndc ILIKE $${values.length}
      OR political_mail_alert_confirmation ILIKE $${values.length}
      OR political_mail_issue_confirmation ILIKE $${values.length}
      OR note ILIKE $${values.length}
    )`);
  }

  return {
    values,
    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function eventToDrop(row) {
  return {
    ...row,
    campaign: row.campaign,
    location: row.location || row.scf || row.usps_last_scan_facility,
    in_home: row.actual_in_home_date || row.estimated_in_home_date || row.in_home,
  };
}

function eventToAlert(row) {
  return {
    id: row.id,
    title: `${row.campaign || "MailOps"} • ${
      row.job_number || row.location || "Operational update"
    }`,
    severity: row.severity,
    source: "MailOps Intelligence",
    detail:
      row.note ||
      row.issue_notes ||
      `${row.event_type || "mail_update"} updated`,
    state: row.state,
    office: row.office,
    risk: row.delivery_risk || row.risk,
    job_number: row.job_number,
    print_vendor: row.print_vendor || row.vendor_name,
    political_mail_alert_confirmation: row.political_mail_alert_confirmation,
    political_mail_issue_confirmation: row.political_mail_issue_confirmation,
  };
}

function buildMetrics(rows) {
  const total = rows.length;

  const elevated = rows.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    const risk = String(row.delivery_risk || row.risk || "").toLowerCase();
    return (
      ["elevated", "delayed", "issue opened"].includes(status) ||
      ["high", "elevated"].includes(risk)
    );
  }).length;

  const onTrack = rows.filter((row) =>
    ["on track", "delivered", "resolved"].includes(
      String(row.status || "").toLowerCase()
    )
  ).length;

  const scfPending = rows.filter(
    (row) => row.expected_scf_arrival_date && !row.actual_scf_arrival_date
  ).length;

  const missingConfirmations = rows.filter(
    (row) =>
      !row.political_mail_alert_confirmation &&
      String(row.delivery_risk || row.risk || "").toLowerCase() === "high"
  ).length;

  return [
    {
      label: "Mail Jobs",
      value: String(total),
      delta: total ? `${total} tracked jobs` : "No jobs",
      tone: "up",
    },
    {
      label: "Delivery Risk",
      value: String(elevated),
      delta: elevated ? `${elevated} elevated` : "No elevated risk",
      tone: elevated ? "down" : "up",
    },
    {
      label: "SCF Pending",
      value: String(scfPending),
      delta: "Awaiting SCF arrival",
      tone: scfPending ? "neutral" : "up",
    },
    {
      label: "USPS Confirmations",
      value: String(missingConfirmations),
      delta: missingConfirmations
        ? "High-risk jobs missing confirmations"
        : "Confirmation posture clean",
      tone: missingConfirmations ? "down" : "up",
    },
  ];
}

export async function getMailOpsDashboard(req, res) {
  try {
    await seedMailOpsEventsIfEmpty();

    const { values, whereSql } = buildWhere(req.query || {});

    const result = await pool.query(
      `
        SELECT *
        FROM mailops_events
        ${whereSql}
        ORDER BY COALESCE(event_time, created_at) DESC NULLS LAST, id DESC
        LIMIT 100
      `,
      values
    );

    const rows = result.rows || [];

    return res.json({
      metrics: buildMetrics(rows),
      drops: rows.slice(0, 20).map(eventToDrop),
      alerts: rows.filter(shouldAlert).slice(0, 20).map(eventToAlert),
      intelligence: {
        usps: {
          political_mail_alert_url: USPS_POLITICAL_MAIL_ALERT_URL,
          political_mail_issue_url: USPS_POLITICAL_MAIL_ISSUE_URL,
          informed_delivery_campaign_url: USPS_INFORMED_DELIVERY_CAMPAIGN_URL,
          iv_mtr_ready: true,
          note:
            "USPS IV-MTR/API credentials can be connected later for automated scan ingestion.",
        },
        snailworks: {
          ingestion_ready: true,
          supported_sources: [
            "CSV export",
            "SFTP drop",
            "API webhook",
            "manual import",
          ],
          note:
            "SnailWorks-style ingestion should use export/API/SFTP access from the client account.",
        },
      },
      _demo: false,
      demo: false,
    });
  } catch (error) {
    console.error("getMailOpsDashboard error:", error.message);
    return res.status(500).json({
      error: error.message || "Failed to load MailOps dashboard",
    });
  }
}

export async function listMailOpsEvents(req, res) {
  try {
    await seedMailOpsEventsIfEmpty();

    const { values, whereSql } = buildWhere(req.query || {});

    const result = await pool.query(
      `
        SELECT *
        FROM mailops_events
        ${whereSql}
        ORDER BY COALESCE(event_time, created_at) DESC NULLS LAST, id DESC
        LIMIT 250
      `,
      values
    );

    return res.json({
      results: result.rows || [],
      _demo: false,
      demo: false,
    });
  } catch (error) {
    console.error("listMailOpsEvents error:", error.message);
    return res.status(500).json({
      error: error.message || "Failed to load MailOps events",
    });
  }
}

export async function createMailOpsEvent(req, res) {
  try {
    await ensureMailOpsEventsTable();

    const payload = req.body || {};

    if (!payload.campaign || !payload.state || !payload.office || !payload.location) {
      return res.status(400).json({
        error: "campaign, state, office, and location are required",
      });
    }

    const firmId = req.auth?.firmId ?? req.user?.firm_id ?? null;
    const userId = req.auth?.userId ?? req.user?.id ?? null;
    const deliveryRisk = nullable(payload.delivery_risk) || calculateRisk(payload);

    const result = await pool.query(
      `
        INSERT INTO mailops_events (
          campaign, state, office, risk, location, vendor_name,
          event_type, status, severity, event_time, in_home, note,
          created_by_user_id, firm_id,
          job_number, assigned_to, date_submitted, print_vendor,
          mail_class, mail_format, quantity, pieces_mailed,
          postage_statement_id, permit_number, crid, mid, imb_mid,
          imb_serial_range, usps_job_id, usps_status,
          usps_last_scan_date, usps_last_scan_facility,
          usps_last_scan_city, usps_last_scan_state,
          expected_scf_arrival_date, actual_scf_arrival_date,
          scf, scf_address, ndc, ndc_address,
          estimated_in_home_date, actual_in_home_date,
          delivery_risk, snailworks_job_id, snailworks_campaign_id,
          snailworks_status, snailworks_last_sync_at, tracking_source,
          issue_status, issue_notes,
          political_mail_alert_confirmation,
          political_mail_issue_confirmation,
          informed_delivery_campaign_name,
          informed_delivery_campaign_id,
          informed_delivery_campaign_url,
          mail_piece_file_name,
          mail_piece_url,
          ps_form_3602_file_name,
          ps_form_3602_url,
          ps_form_8125_file_name,
          ps_form_8125_url,
          created_at, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          COALESCE($10::timestamp, NOW()),
          $11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,
          $28,$29,$30,$31,$32,$33,$34,$35,$36,$37,
          $38,$39,$40,$41,$42,$43,$44,$45,$46,$47,
          $48,$49,$50,$51,$52,$53,$54,$55,$56,$57,
          NOW(), NOW()
        )
        RETURNING *
      `,
      [
        text(payload.campaign),
        text(payload.state),
        text(payload.office),
        nullable(payload.risk),
        text(payload.location),
        nullable(payload.vendor_name || payload.print_vendor),
        normalizeEventType(payload.event_type),
        normalizeStatus(payload.status),
        normalizeSeverity(payload.severity),
        payload.event_time || null,
        dateOrNull(payload.in_home || payload.estimated_in_home_date),
        nullable(payload.note || payload.notes),
        userId,
        firmId,

        nullable(payload.job_number),
        nullable(payload.assigned_to),
        dateOrNull(payload.date_submitted),
        nullable(payload.print_vendor || payload.vendor_name),
        normalizeMailClass(payload.mail_class),
        normalizeMailFormat(payload.mail_format),
        payload.quantity ? toNumber(payload.quantity) : null,
        payload.pieces_mailed ? toNumber(payload.pieces_mailed) : null,
        nullable(payload.postage_statement_id),
        nullable(payload.permit_number),
        nullable(payload.crid),
        nullable(payload.mid),
        nullable(payload.imb_mid),
        nullable(payload.imb_serial_range),
        nullable(payload.usps_job_id),
        nullable(payload.usps_status),
        payload.usps_last_scan_date || null,
        nullable(payload.usps_last_scan_facility),
        nullable(payload.usps_last_scan_city),
        nullable(payload.usps_last_scan_state),
        dateOrNull(payload.expected_scf_arrival_date),
        dateOrNull(payload.actual_scf_arrival_date),
        nullable(payload.scf),
        nullable(payload.scf_address),
        nullable(payload.ndc),
        nullable(payload.ndc_address),
        dateOrNull(payload.estimated_in_home_date || payload.in_home),
        dateOrNull(payload.actual_in_home_date),
        deliveryRisk,
        nullable(payload.snailworks_job_id),
        nullable(payload.snailworks_campaign_id),
        nullable(payload.snailworks_status),
        payload.snailworks_last_sync_at || null,
        nullable(payload.tracking_source) || "manual",
        nullable(payload.issue_status),
        nullable(payload.issue_notes),
        nullable(payload.political_mail_alert_confirmation),
        nullable(payload.political_mail_issue_confirmation),
        nullable(payload.informed_delivery_campaign_name),
        nullable(payload.informed_delivery_campaign_id),
        nullable(payload.informed_delivery_campaign_url) ||
          USPS_INFORMED_DELIVERY_CAMPAIGN_URL,
        nullable(payload.mail_piece_file_name),
        nullable(payload.mail_piece_url),
        nullable(payload.ps_form_3602_file_name),
        nullable(payload.ps_form_3602_url),
        nullable(payload.ps_form_8125_file_name),
        nullable(payload.ps_form_8125_url),
      ]
    );

    const event = result.rows[0];
    publishMailOps("mailops.event_created", event);

    return res.status(201).json({
      ok: true,
      event,
    });
  } catch (error) {
    console.error("createMailOpsEvent error:", error.message);
    return res.status(500).json({
      error: error.message || "Failed to create MailOps event",
    });
  }
}

export async function updateMailOpsEvent(req, res) {
  try {
    await ensureMailOpsEventsTable();

    const { eventId } = req.params;
    const payload = req.body || {};

    if (!eventId) {
      return res.status(400).json({ error: "eventId is required" });
    }

    const allowed = {
      campaign: payload.campaign,
      state: payload.state,
      office: payload.office,
      risk: payload.risk,
      location: payload.location,
      vendor_name: payload.vendor_name,
      event_type:
        payload.event_type !== undefined
          ? normalizeEventType(payload.event_type)
          : undefined,
      status:
        payload.status !== undefined ? normalizeStatus(payload.status) : undefined,
      severity:
        payload.severity !== undefined
          ? normalizeSeverity(payload.severity)
          : undefined,
      event_time: payload.event_time,
      in_home: payload.in_home,
      note: payload.note,

      job_number: payload.job_number,
      assigned_to: payload.assigned_to,
      date_submitted: payload.date_submitted,
      print_vendor: payload.print_vendor,
      mail_class:
        payload.mail_class !== undefined
          ? normalizeMailClass(payload.mail_class)
          : undefined,
      mail_format:
        payload.mail_format !== undefined
          ? normalizeMailFormat(payload.mail_format)
          : undefined,
      quantity: payload.quantity,
      pieces_mailed: payload.pieces_mailed,
      postage_statement_id: payload.postage_statement_id,
      permit_number: payload.permit_number,
      crid: payload.crid,
      mid: payload.mid,
      imb_mid: payload.imb_mid,
      imb_serial_range: payload.imb_serial_range,
      usps_job_id: payload.usps_job_id,
      usps_status: payload.usps_status,
      usps_last_scan_date: payload.usps_last_scan_date,
      usps_last_scan_facility: payload.usps_last_scan_facility,
      usps_last_scan_city: payload.usps_last_scan_city,
      usps_last_scan_state: payload.usps_last_scan_state,
      expected_scf_arrival_date: payload.expected_scf_arrival_date,
      actual_scf_arrival_date: payload.actual_scf_arrival_date,
      scf: payload.scf,
      scf_address: payload.scf_address,
      ndc: payload.ndc,
      ndc_address: payload.ndc_address,
      estimated_in_home_date: payload.estimated_in_home_date,
      actual_in_home_date: payload.actual_in_home_date,
      delivery_risk: payload.delivery_risk,
      snailworks_job_id: payload.snailworks_job_id,
      snailworks_campaign_id: payload.snailworks_campaign_id,
      snailworks_status: payload.snailworks_status,
      snailworks_last_sync_at: payload.snailworks_last_sync_at,
      tracking_source: payload.tracking_source,
      issue_status: payload.issue_status,
      issue_notes: payload.issue_notes,

      political_mail_alert_confirmation:
        payload.political_mail_alert_confirmation,
      political_mail_issue_confirmation:
        payload.political_mail_issue_confirmation,
      informed_delivery_campaign_name:
        payload.informed_delivery_campaign_name,
      informed_delivery_campaign_id: payload.informed_delivery_campaign_id,
      informed_delivery_campaign_url: payload.informed_delivery_campaign_url,

      mail_piece_file_name: payload.mail_piece_file_name,
      mail_piece_url: payload.mail_piece_url,
      ps_form_3602_file_name: payload.ps_form_3602_file_name,
      ps_form_3602_url: payload.ps_form_3602_url,
      ps_form_8125_file_name: payload.ps_form_8125_file_name,
      ps_form_8125_url: payload.ps_form_8125_url,
    };

    const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);

    if (!entries.length) {
      return res.status(400).json({
        error: "No updatable fields were provided",
      });
    }

    const values = [];
    const setParts = entries.map(([key, value], index) => {
      values.push(value === "" ? null : value);
      return `${key} = $${index + 1}`;
    });

    values.push(eventId);

    const result = await pool.query(
      `
        UPDATE mailops_events
        SET ${setParts.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "MailOps event not found",
      });
    }

    const event = result.rows[0];
    publishMailOps("mailops.event_updated", event);

    return res.json({
      ok: true,
      event,
    });
  } catch (error) {
    console.error("updateMailOpsEvent error:", error.message);
    return res.status(500).json({
      error: error.message || "Failed to update MailOps event",
    });
  }
}
