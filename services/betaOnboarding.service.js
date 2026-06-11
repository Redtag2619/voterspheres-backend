import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function clean(value = "") {
  return String(value || "").trim();
}

function number(value = 0) {
  return Number(value || 0);
}

async function ensureBetaTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS beta_customers (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      firm_name TEXT NOT NULL,
      primary_contact TEXT,
      email TEXT,
      phone TEXT,
      state TEXT,
      segment TEXT DEFAULT 'Political Consultant',
      invite_status TEXT DEFAULT 'not_sent',
      onboarding_stage TEXT DEFAULT 'lead',
      demo_status TEXT DEFAULT 'not_scheduled',
      workspace_status TEXT DEFAULT 'not_started',
      billing_status TEXT DEFAULT 'not_started',
      launch_confidence INTEGER DEFAULT 50,
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      feedback TEXT,
      next_step TEXT,
      demo_date DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_beta_customers_firm_id
    ON beta_customers(firm_id)
  `);
}

function normalize(value = "", allowed = [], fallback = "") {
  const v = String(value || "").toLowerCase().replace(/\s+/g, "_");
  return allowed.includes(v) ? v : fallback;
}

function normalizeStage(value = "") {
  return normalize(
    value,
    ["lead", "invited", "demo_scheduled", "onboarding", "active_beta", "converted", "paused"],
    "lead"
  );
}

function normalizePriority(value = "") {
  return normalize(value, ["low", "medium", "high", "critical"], "medium");
}

function confidenceLabel(score = 0) {
  const n = number(score);
  if (n >= 85) return "High Confidence";
  if (n >= 65) return "Promising";
  if (n >= 40) return "Needs Work";
  return "At Risk";
}

function buildChecklist(customer = {}) {
  return [
    {
      key: "invite_sent",
      label: "Invite Sent",
      complete: ["sent", "accepted"].includes(customer.invite_status),
      status: customer.invite_status,
    },
    {
      key: "demo_scheduled",
      label: "Demo Scheduled",
      complete: ["scheduled", "completed"].includes(customer.demo_status),
      status: customer.demo_status,
    },
    {
      key: "workspace_created",
      label: "Workspace Created",
      complete: ["created", "complete"].includes(customer.workspace_status),
      status: customer.workspace_status,
    },
    {
      key: "billing_started",
      label: "Billing Started",
      complete: ["trial", "active", "paid"].includes(customer.billing_status),
      status: customer.billing_status,
    },
    {
      key: "feedback_logged",
      label: "Feedback Logged",
      complete: Boolean(clean(customer.feedback)),
      status: clean(customer.feedback) ? "complete" : "missing",
    },
    {
      key: "next_step",
      label: "Next Step Assigned",
      complete: Boolean(clean(customer.next_step)),
      status: clean(customer.next_step) ? "assigned" : "missing",
    },
  ];
}

function enrichCustomer(customer = {}) {
  const checklist = buildChecklist(customer);
  const completed = checklist.filter((item) => item.complete).length;
  const setup_score = Math.round((completed / checklist.length) * 100);

  return {
    ...customer,
    launch_confidence: number(customer.launch_confidence),
    setup_score,
    confidence_label: confidenceLabel(customer.launch_confidence),
    checklist,
  };
}

export async function getBetaOnboarding({ user = {}, stage = "", q = "", priority = "" }) {
  await ensureBetaTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const filters = ["firm_id = $1"];
  const params = [firmId];
  let index = 2;

  if (stage) {
    filters.push(`onboarding_stage = $${index}`);
    params.push(normalizeStage(stage));
    index += 1;
  }

  if (priority) {
    filters.push(`priority = $${index}`);
    params.push(normalizePriority(priority));
    index += 1;
  }

  if (q) {
    filters.push(`(
      firm_name ILIKE $${index}
      OR COALESCE(primary_contact,'') ILIKE $${index}
      OR COALESCE(email,'') ILIKE $${index}
      OR COALESCE(state,'') ILIKE $${index}
      OR COALESCE(segment,'') ILIKE $${index}
      OR COALESCE(notes,'') ILIKE $${index}
      OR COALESCE(feedback,'') ILIKE $${index}
    )`);
    params.push(`%${q}%`);
    index += 1;
  }

  const result = await pool.query(
    `
      SELECT *
      FROM beta_customers
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        launch_confidence DESC,
        updated_at DESC
      LIMIT 250
    `,
    params
  );

  const customers = (result.rows || []).map(enrichCustomer);

  const summary = {
    total: customers.length,
    invited: customers.filter((c) => ["sent", "accepted"].includes(c.invite_status)).length,
    demos: customers.filter((c) => ["scheduled", "completed"].includes(c.demo_status)).length,
    active_beta: customers.filter((c) => c.onboarding_stage === "active_beta").length,
    converted: customers.filter((c) => c.onboarding_stage === "converted").length,
    at_risk: customers.filter((c) => number(c.launch_confidence) < 40).length,
    average_confidence: customers.length
      ? Math.round(customers.reduce((sum, c) => sum + number(c.launch_confidence), 0) / customers.length)
      : 0,
    average_setup: customers.length
      ? Math.round(customers.reduce((sum, c) => sum + number(c.setup_score), 0) / customers.length)
      : 0,
  };

  return {
    summary,
    customers,
    filters: { stage, q, priority },
    updated_at: new Date().toISOString(),
  };
}

export async function saveBetaCustomer({ user = {}, payload = {} }) {
  await ensureBetaTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const firmName = clean(payload.firm_name);
  if (!firmName) throw new Error("Firm name is required.");

  if (payload.id) {
    const updated = await pool.query(
      `
        UPDATE beta_customers
        SET
          firm_name = $1,
          primary_contact = $2,
          email = $3,
          phone = $4,
          state = $5,
          segment = $6,
          invite_status = $7,
          onboarding_stage = $8,
          demo_status = $9,
          workspace_status = $10,
          billing_status = $11,
          launch_confidence = $12,
          priority = $13,
          notes = $14,
          feedback = $15,
          next_step = $16,
          demo_date = $17,
          updated_at = NOW()
        WHERE id = $18 AND firm_id = $19
        RETURNING *
      `,
      [
        firmName,
        clean(payload.primary_contact),
        clean(payload.email),
        clean(payload.phone),
        clean(payload.state),
        clean(payload.segment || "Political Consultant"),
        clean(payload.invite_status || "not_sent"),
        normalizeStage(payload.onboarding_stage),
        clean(payload.demo_status || "not_scheduled"),
        clean(payload.workspace_status || "not_started"),
        clean(payload.billing_status || "not_started"),
        Math.max(0, Math.min(100, number(payload.launch_confidence || 50))),
        normalizePriority(payload.priority),
        clean(payload.notes),
        clean(payload.feedback),
        clean(payload.next_step),
        payload.demo_date || null,
        payload.id,
        firmId,
      ]
    );

    if (!updated.rows[0]) throw new Error("Beta customer not found.");

    return {
      customer: enrichCustomer(updated.rows[0]),
      message: "Beta customer updated.",
    };
  }

  const inserted = await pool.query(
    `
      INSERT INTO beta_customers (
        firm_id,
        firm_name,
        primary_contact,
        email,
        phone,
        state,
        segment,
        invite_status,
        onboarding_stage,
        demo_status,
        workspace_status,
        billing_status,
        launch_confidence,
        priority,
        notes,
        feedback,
        next_step,
        demo_date,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      firmName,
      clean(payload.primary_contact),
      clean(payload.email),
      clean(payload.phone),
      clean(payload.state),
      clean(payload.segment || "Political Consultant"),
      clean(payload.invite_status || "not_sent"),
      normalizeStage(payload.onboarding_stage),
      clean(payload.demo_status || "not_scheduled"),
      clean(payload.workspace_status || "not_started"),
      clean(payload.billing_status || "not_started"),
      Math.max(0, Math.min(100, number(payload.launch_confidence || 50))),
      normalizePriority(payload.priority),
      clean(payload.notes),
      clean(payload.feedback),
      clean(payload.next_step),
      payload.demo_date || null,
    ]
  );

  return {
    customer: enrichCustomer(inserted.rows[0]),
    message: "Beta customer created.",
  };
}

export async function updateBetaCustomerStage({ user = {}, id, stage = "" }) {
  await ensureBetaTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      UPDATE beta_customers
      SET onboarding_stage = $1, updated_at = NOW()
      WHERE id = $2 AND firm_id = $3
      RETURNING *
    `,
    [normalizeStage(stage), id, firmId]
  );

  if (!result.rows[0]) throw new Error("Beta customer not found.");

  return {
    customer: enrichCustomer(result.rows[0]),
    message: "Beta onboarding stage updated.",
  };
}

export async function deleteBetaCustomer({ user = {}, id }) {
  await ensureBetaTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  await pool.query(
    `
      DELETE FROM beta_customers
      WHERE id = $1 AND firm_id = $2
    `,
    [id, firmId]
  );

  return { message: "Beta customer deleted." };
}
