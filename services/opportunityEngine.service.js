import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[opportunity-engine] skipped query:", error.message);
    return [];
  }
}

function number(value = 0) {
  return Number(value || 0);
}

function clean(value = "") {
  return String(value || "").trim();
}

function normalizeParty(party = "") {
  const v = String(party || "").toLowerCase();
  if (v.includes("dem") || v === "d") return "Democratic";
  if (v.includes("rep") || v.includes("gop") || v === "r") return "Republican";
  if (v.includes("ind") || v === "i") return "Independent";
  return party || "Unknown";
}

function scoreOpportunity(candidate = {}, related = {}) {
  let score = 35;

  if (candidate.fec_candidate_id) score += 10;
  if (candidate.website) score += 6;
  if (candidate.contact_email || candidate.press_email) score += 8;
  if (candidate.phone) score += 5;
  if (candidate.office) score += 5;
  if (candidate.state || candidate.state_code) score += 5;

  score += Math.min(15, number(related.signal_count) * 3);
  score += Math.min(12, number(related.vendor_count) * 2);
  score += Math.min(10, number(related.report_count) * 2);
  score += Math.min(10, number(related.task_count) * 2);

  const office = String(candidate.office || "").toLowerCase();
  if (office.includes("senate") || office.includes("governor")) score += 8;
  if (office.includes("house") || office.includes("congress")) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreLabel(score) {
  if (score >= 85) return "Hot";
  if (score >= 70) return "High";
  if (score >= 50) return "Develop";
  return "Watch";
}

function recommendedAction(score, candidate = {}) {
  if (score >= 85) return `Prepare proposal and outreach plan for ${candidate.full_name || candidate.name || "this campaign"}.`;
  if (score >= 70) return "Assign consultant follow-up and build campaign opportunity brief.";
  if (score >= 50) return "Enrich contact data and monitor funding/signals.";
  return "Keep on watchlist until more activity appears.";
}

export async function getOpportunityEngine({ user = {}, state = "", party = "", office = "", q = "" }) {
  const firmId = getFirmId(user);

  const filters = [];
  const params = [];
  let index = 1;

  if (q) {
    filters.push(`(
      COALESCE(full_name, name, '') ILIKE $${index}
      OR COALESCE(office, '') ILIKE $${index}
      OR COALESCE(state, state_code, '') ILIKE $${index}
      OR COALESCE(party, '') ILIKE $${index}
    )`);
    params.push(`%${q}%`);
    index += 1;
  }

  if (state) {
    filters.push(`COALESCE(state, state_code, '') ILIKE $${index}`);
    params.push(`%${state}%`);
    index += 1;
  }

  if (party) {
    filters.push(`COALESCE(party, '') ILIKE $${index}`);
    params.push(`%${party}%`);
    index += 1;
  }

  if (office) {
    filters.push(`COALESCE(office, '') ILIKE $${index}`);
    params.push(`%${office}%`);
    index += 1;
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const candidates = await safeQuery(
    `
      SELECT
        id,
        full_name,
        name,
        office,
        state,
        state_code,
        party,
        election_year,
        election_type,
        campaign_status,
        website,
        contact_email,
        press_email,
        phone,
        fec_candidate_id,
        updated_at,
        created_at
      FROM candidates
      ${where}
      ORDER BY election_year DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 150
    `,
    params
  );

  const candidateStates = Array.from(
    new Set(candidates.map((c) => c.state || c.state_code).filter(Boolean))
  );

  const signals = firmId
    ? await safeQuery(
        `
          SELECT state, COUNT(*)::int AS count
          FROM political_signals
          WHERE firm_id = $1
          GROUP BY state
        `,
        [firmId]
      )
    : [];

  const vendors = firmId
    ? await safeQuery(
        `
          SELECT state, COUNT(*)::int AS count
          FROM vendors
          WHERE firm_id = $1
          GROUP BY state
        `,
        [firmId]
      )
    : [];

  const reports = firmId
    ? await safeQuery(
        `
          SELECT state, COUNT(*)::int AS count
          FROM intelligence_reports
          WHERE firm_id = $1
          GROUP BY state
        `,
        [firmId]
      )
    : [];

  const tasks = firmId
    ? await safeQuery(
        `
          SELECT state, COUNT(*)::int AS count
          FROM tasks
          WHERE firm_id = $1
          GROUP BY state
        `,
        [firmId]
      )
    : [];

  const existingCrm = firmId
    ? await safeQuery(
        `
          SELECT full_name, state, COUNT(*)::int AS count
          FROM campaign_crm_contacts
          WHERE firm_id = $1
          GROUP BY full_name, state
        `,
        [firmId]
      )
    : [];

  const stateCount = (rows, value) => {
    const found = rows.find((r) => String(r.state || "").toLowerCase() === String(value || "").toLowerCase());
    return number(found?.count);
  };

  const crmExists = (candidate) => {
    const name = clean(candidate.full_name || candidate.name).toLowerCase();
    const stateValue = clean(candidate.state || candidate.state_code).toLowerCase();

    return existingCrm.some((row) => {
      return (
        clean(row.full_name).toLowerCase() === name &&
        (!stateValue || clean(row.state).toLowerCase() === stateValue)
      );
    });
  };

  const opportunities = candidates.map((candidate) => {
    const candidateState = candidate.state || candidate.state_code || "National";

    const related = {
      signal_count: stateCount(signals, candidateState),
      vendor_count: stateCount(vendors, candidateState),
      report_count: stateCount(reports, candidateState),
      task_count: stateCount(tasks, candidateState),
    };

    const score = scoreOpportunity(candidate, related);

    return {
      id: candidate.id,
      candidate_id: candidate.id,
      candidate_name: candidate.full_name || candidate.name || `Candidate ${candidate.id}`,
      office: candidate.office || "Office N/A",
      state: candidateState,
      party: normalizeParty(candidate.party),
      cycle: candidate.election_year || "2026",
      campaign_status: candidate.campaign_status || "Unknown",
      website: candidate.website || "",
      email: candidate.contact_email || candidate.press_email || "",
      phone: candidate.phone || "",
      fec_candidate_id: candidate.fec_candidate_id || "",
      score,
      score_label: scoreLabel(score),
      recommended_action: recommendedAction(score, candidate),
      crm_exists: crmExists(candidate),
      related,
      path: `/candidates?id=${candidate.id}`,
      updated_at: candidate.updated_at || candidate.created_at,
    };
  });

  opportunities.sort((a, b) => b.score - a.score);

  const hot = opportunities.filter((o) => o.score >= 85).length;
  const high = opportunities.filter((o) => o.score >= 70 && o.score < 85).length;
  const develop = opportunities.filter((o) => o.score >= 50 && o.score < 70).length;
  const watch = opportunities.filter((o) => o.score < 50).length;

  return {
    summary: {
      total: opportunities.length,
      hot,
      high,
      develop,
      watch,
      crm_ready: opportunities.filter((o) => o.crm_exists).length,
      states: candidateStates.length,
      average_score: opportunities.length
        ? Math.round(opportunities.reduce((sum, row) => sum + number(row.score), 0) / opportunities.length)
        : 0,
    },
    opportunities,
    filters: { state, party, office, q },
    updated_at: new Date().toISOString(),
  };
}

export async function createOpportunityCrmContact({ user = {}, opportunity = {} }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const name = clean(opportunity.candidate_name || opportunity.full_name || opportunity.name);
  if (!name) throw new Error("Missing candidate name.");

  const existing = await safeQuery(
    `
      SELECT id
      FROM campaign_crm_contacts
      WHERE firm_id = $1
        AND LOWER(full_name) = LOWER($2)
      LIMIT 1
    `,
    [firmId, name]
  );

  if (existing[0]?.id) {
    return {
      created: false,
      contact_id: existing[0].id,
      message: "CRM contact already exists.",
    };
  }

  const inserted = await pool.query(
    `
      INSERT INTO campaign_crm_contacts (
        firm_id,
        full_name,
        organization,
        role_type,
        state,
        email,
        phone,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      RETURNING id
    `,
    [
      firmId,
      name,
      opportunity.office || "Campaign Opportunity",
      "Candidate / Campaign",
      opportunity.state || null,
      opportunity.email || null,
      opportunity.phone || null,
      opportunity.recommended_action || "Created from Opportunity Engine.",
    ]
  );

  return {
    created: true,
    contact_id: inserted.rows[0]?.id,
    message: "CRM contact created.",
  };
}

export async function createOpportunityTask({ user = {}, opportunity = {} }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const title = `Opportunity follow-up: ${opportunity.candidate_name || "Campaign"}`;

  const inserted = await pool.query(
    `
      INSERT INTO tasks (
        firm_id,
        title,
        description,
        status,
        priority,
        state,
        source,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING id
    `,
    [
      firmId,
      title,
      opportunity.recommended_action || "Review opportunity and assign next step.",
      "open",
      Number(opportunity.score || 0) >= 85 ? "critical" : Number(opportunity.score || 0) >= 70 ? "high" : "normal",
      opportunity.state || null,
      "opportunity_engine",
    ]
  );

  return {
    created: true,
    task_id: inserted.rows[0]?.id,
    message: "Opportunity follow-up task created.",
  };
}
