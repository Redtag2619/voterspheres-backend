import pool from "../config/database.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function first(...values) {
  for (const value of values) {
    const next = clean(value);
    if (next) return next;
  }
  return "";
}

function stateOf(row) {
  return first(row.state, row.state_code, row.coverage_state).toUpperCase();
}

function partyOf(row) {
  return first(row.party, row.party_affiliation).toLowerCase();
}

function moneyLabel(value) {
  const amount = num(value);
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function candidateName(row) {
  return first(
    row.full_name,
    row.name,
    [row.first_name, row.last_name].filter(Boolean).join(" ")
  ) || "Candidate";
}

function consultantName(row) {
  return first(row.name, row.firm_name, row.consultant_name, row.company) || "Consultant";
}

function donorName(row) {
  return first(row.name, row.donor_name, row.committee_name) || "Donor";
}

function candidateScore(row) {
  let score = 30;
  if (row.contact_email || row.email || row.phone) score += 15;
  if (row.website || row.campaign_website) score += 10;
  if (row.state || row.state_code) score += 8;
  if (row.office) score += 8;
  if (row.party) score += 5;
  if (row.contact_verified) score += 12;
  if (row.incumbent) score += 8;
  return Math.min(100, score);
}

function consultantScore(row) {
  let score = 35;
  if (row.state || row.coverage_state) score += 10;
  if (row.specialty || row.category || row.service_category) score += 10;
  if (row.win_rate) score += Math.min(20, num(row.win_rate) / 5);
  if (row.clients_count) score += Math.min(15, num(row.clients_count));
  if (row.rating) score += Math.min(10, num(row.rating) * 2);
  return Math.min(100, Math.round(score));
}

function donorScore(row) {
  const amount = num(
    row.total_amount ||
      row.amount ||
      row.contribution_amount ||
      row.total_contributions
  );

  let score = 25;
  if (amount) score += Math.min(45, Math.log10(Math.max(amount, 1)) * 8);
  if (row.state) score += 8;
  if (row.party || row.party_affiliation) score += 7;
  if (row.cycle) score += 5;
  return Math.min(100, Math.round(score));
}

function stateMatch(a, b) {
  const left = stateOf(a);
  const right = stateOf(b);
  return Boolean(left && right && left === right);
}

function partyMatch(a, b) {
  const left = partyOf(a);
  const right = partyOf(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function officeMatch(candidate, consultant) {
  const office = clean(candidate.office).toLowerCase();
  const specialty = first(
    consultant.specialty,
    consultant.category,
    consultant.service_category
  ).toLowerCase();

  if (!office || !specialty) return false;
  return specialty.includes(office) || office.includes(specialty);
}

async function querySafe(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("Relationship graph query fallback:", error.message);
    return [];
  }
}

async function fetchCandidates({ state, party, office, limit }) {
  const params = [];
  const where = [];

  if (state) {
    params.push(state);
    where.push(`UPPER(COALESCE(c.state, c.state_code, '')) = UPPER($${params.length})`);
  }

  if (party) {
    params.push(`%${party}%`);
    where.push(`COALESCE(c.party, '') ILIKE $${params.length}`);
  }

  if (office) {
    params.push(`%${office}%`);
    where.push(`COALESCE(c.office, '') ILIKE $${params.length}`);
  }

  params.push(limit);
  const limitParam = params.length;

  return querySafe(
    `
      SELECT
        c.id,
        c.fec_candidate_id,
        COALESCE(c.full_name, c.name) AS full_name,
        c.name,
        c.party,
        c.office,
        c.state,
        c.state_code,
        c.district,
        c.website,
        c.contact_email,
        c.press_email,
        c.phone,
        c.incumbent,
        c.contact_verified,
        cp.campaign_website,
        cp.email,
        cp.contact_confidence,
        cp.source_label
      FROM candidates c
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        COALESCE(cp.contact_confidence, 0) DESC,
        c.id ASC
      LIMIT $${limitParam}
    `,
    params
  );
}

async function fetchConsultants({ state, limit }) {
  const params = [];
  const where = [];

  if (state) {
    params.push(state);
    where.push(`UPPER(COALESCE(state, coverage_state, '')) = UPPER($${params.length})`);
  }

  params.push(limit);
  const limitParam = params.length;

  return querySafe(
    `
      SELECT *
      FROM consultants
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id ASC
      LIMIT $${limitParam}
    `,
    params
  );
}

async function fetchDonors({ state, party, limit }) {
  const params = [];
  const where = [];

  if (state) {
    params.push(state);
    where.push(`UPPER(COALESCE(state, '')) = UPPER($${params.length})`);
  }

  if (party) {
    params.push(`%${party}%`);
    where.push(`COALESCE(party, party_affiliation, '') ILIKE $${params.length}`);
  }

  params.push(limit);
  const limitParam = params.length;

  return querySafe(
    `
      SELECT *
      FROM donors
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id ASC
      LIMIT $${limitParam}
    `,
    params
  );
}

function buildNodes({ candidates, consultants, donors }) {
  const nodes = [];

  for (const row of candidates) {
    nodes.push({
      id: `candidate-${row.id || row.fec_candidate_id}`,
      source_id: row.id,
      type: "candidate",
      label: candidateName(row),
      subtitle: `${first(row.state, row.state_code, "N/A")} • ${first(row.office, "Office")}`,
      state: first(row.state, row.state_code),
      party: first(row.party),
      influence: candidateScore(row),
      raw: row,
    });
  }

  for (const row of consultants) {
    nodes.push({
      id: `consultant-${row.id || consultantName(row)}`,
      source_id: row.id,
      type: "consultant",
      label: consultantName(row),
      subtitle: first(row.state, row.coverage_state, row.category, "Consultant"),
      state: first(row.state, row.coverage_state),
      party: first(row.party, row.party_affiliation),
      influence: consultantScore(row),
      raw: row,
    });
  }

  for (const row of donors) {
    const amount = num(
      row.total_amount ||
        row.amount ||
        row.contribution_amount ||
        row.total_contributions
    );

    nodes.push({
      id: `donor-${row.id || row.donor_id || donorName(row)}`,
      source_id: row.id || row.donor_id,
      type: "donor",
      label: donorName(row),
      subtitle: `${first(row.state, "National")} • ${moneyLabel(amount)}`,
      state: first(row.state),
      party: first(row.party, row.party_affiliation),
      influence: donorScore(row),
      raw: row,
    });
  }

  return nodes;
}

function buildLinks(nodes) {
  const links = [];

  const candidates = nodes.filter((node) => node.type === "candidate");
  const consultants = nodes.filter((node) => node.type === "consultant");
  const donors = nodes.filter((node) => node.type === "donor");

  for (const candidate of candidates) {
    const consultantMatches = consultants
      .map((consultant) => {
        let strength = 0;
        if (stateMatch(candidate.raw, consultant.raw)) strength += 45;
        if (officeMatch(candidate.raw, consultant.raw)) strength += 25;
        if (partyMatch(candidate.raw, consultant.raw)) strength += 15;
        strength += Math.min(15, consultant.influence / 8);
        return { consultant, strength };
      })
      .filter((item) => item.strength >= 35)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3);

    for (const match of consultantMatches) {
      links.push({
        source: candidate.id,
        target: match.consultant.id,
        type: "candidate_consultant",
        strength: Math.round(match.strength),
        label: "Consultant fit",
      });
    }

    const donorMatches = donors
      .map((donor) => {
        let strength = 0;
        if (stateMatch(candidate.raw, donor.raw)) strength += 35;
        if (partyMatch(candidate.raw, donor.raw)) strength += 25;
        strength += Math.min(35, donor.influence / 2);
        return { donor, strength };
      })
      .filter((item) => item.strength >= 32)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4);

    for (const match of donorMatches) {
      links.push({
        source: candidate.id,
        target: match.donor.id,
        type: "candidate_donor",
        strength: Math.round(match.strength),
        label: "Donor affinity",
      });
    }
  }

  for (const consultant of consultants) {
    const donorMatches = donors
      .map((donor) => {
        let strength = 0;
        if (stateMatch(consultant.raw, donor.raw)) strength += 25;
        if (partyMatch(consultant.raw, donor.raw)) strength += 18;
        strength += Math.min(20, (consultant.influence + donor.influence) / 10);
        return { donor, strength };
      })
      .filter((item) => item.strength >= 30)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 2);

    for (const match of donorMatches) {
      links.push({
        source: consultant.id,
        target: match.donor.id,
        type: "consultant_donor",
        strength: Math.round(match.strength),
        label: "Network overlap",
      });
    }
  }

  return links;
}

function buildInsights(nodes, links) {
  const candidates = nodes.filter((node) => node.type === "candidate");
  const consultants = nodes.filter((node) => node.type === "consultant");
  const donors = nodes.filter((node) => node.type === "donor");

  const topInfluencers = [...nodes]
    .sort((a, b) => b.influence - a.influence)
    .slice(0, 10);

  const strongestLinks = [...links]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);

  const orphanCandidates = candidates.filter((candidate) => {
    return !links.some(
      (link) => link.source === candidate.id || link.target === candidate.id
    );
  });

  return {
    summary: [
      `${candidates.length} candidate nodes mapped against ${consultants.length} consultant nodes and ${donors.length} donor nodes.`,
      `${strongestLinks.length} high-value relationship paths are ready for consultant or fundraising action.`,
      `${orphanCandidates.length} candidates have weak network coverage and should be prioritized for enrichment.`,
    ],
    top_influencers: topInfluencers,
    strongest_links: strongestLinks,
    orphan_candidates: orphanCandidates.slice(0, 20),
  };
}

export async function getRelationshipGraph(options = {}) {
  const limit = Math.min(Math.max(num(options.limit, 50), 10), 150);

  const filters = {
    state: clean(options.state),
    party: clean(options.party),
    office: clean(options.office),
    limit,
  };

  const [candidates, consultants, donors] = await Promise.all([
    fetchCandidates(filters),
    fetchConsultants(filters),
    fetchDonors(filters),
  ]);

  const nodes = buildNodes({ candidates, consultants, donors });
  const links = buildLinks(nodes);
  const insights = buildInsights(nodes, links);

  return {
    filters,
    counts: {
      candidates: candidates.length,
      consultants: consultants.length,
      donors: donors.length,
      nodes: nodes.length,
      links: links.length,
    },
    nodes,
    links,
    insights,
  };
}
