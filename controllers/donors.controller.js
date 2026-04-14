import { pool } from "../db/pool.js";

const demoDonorNetwork = {
  results: [
    {
      id: 1,
      donor_name: "Atlantic Leadership Fund",
      donor_type: "PAC",
      state: "Georgia",
      amount: 250000,
      relationship_strength: "High",
      candidate_id: null
    },
    {
      id: 2,
      donor_name: "Keystone Civic Network",
      donor_type: "Individual Network",
      state: "Pennsylvania",
      amount: 175000,
      relationship_strength: "Medium",
      candidate_id: null
    },
    {
      id: 3,
      donor_name: "Great Lakes Action Council",
      donor_type: "PAC",
      state: "Michigan",
      amount: 120000,
      relationship_strength: "Growing",
      candidate_id: null
    }
  ],
  summary: {
    total_donors: 3,
    total_amount: 545000,
    top_state: "Georgia"
  },
  demo: true
};

async function getTableColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set((result.rows || []).map((row) => row.column_name));
}

async function getCandidateContext(query = {}) {
  const candidateId = query.candidate_id || null;
  const search = String(query.search || "").trim();
  const state = String(query.state || "").trim();

  if (candidateId) {
    const result = await pool.query(
      `
        SELECT
          candidate_id,
          name,
          state,
          office,
          party
        FROM fundraising_live
        WHERE candidate_id = $1
        LIMIT 1
      `,
      [candidateId]
    );

    return result.rows?.[0] || null;
  }

  if (search) {
    const values = [`%${search}%`];
    let sql = `
      SELECT
        candidate_id,
        name,
        state,
        office,
        party
      FROM fundraising_live
      WHERE name ILIKE $1
    `;

    if (state) {
      values.push(state);
      sql += ` AND state = $2`;
    }

    sql += `
      ORDER BY receipts DESC NULLS LAST, cash_on_hand DESC NULLS LAST
      LIMIT 1
    `;

    const result = await pool.query(sql, values);
    return result.rows?.[0] || null;
  }

  return null;
}

function buildSelectClause(columns) {
  const selectable = [];

  if (columns.has("id")) selectable.push("id");
  if (columns.has("donor_name")) selectable.push("donor_name");
  if (columns.has("donor_type")) selectable.push("donor_type");
  if (columns.has("state")) selectable.push("state");
  if (columns.has("amount")) selectable.push("amount");
  if (columns.has("relationship_strength")) selectable.push("relationship_strength");
  if (columns.has("candidate_id")) selectable.push("candidate_id");
  if (columns.has("candidate_name")) selectable.push("candidate_name");
  if (columns.has("campaign_name")) selectable.push("campaign_name");
  if (columns.has("recipient_name")) selectable.push("recipient_name");
  if (columns.has("committee_name")) selectable.push("committee_name");
  if (columns.has("supported_candidate")) selectable.push("supported_candidate");

  return selectable.length ? selectable.join(", ") : "*";
}

function pushCondition(conditions, values, sqlFragment, value) {
  values.push(value);
  conditions.push(sqlFragment.replace("?", `$${values.length}`));
}

function addTextMatchAcrossColumns(columnsToTry, columns, conditions, values, searchText) {
  const available = columnsToTry.filter((column) => columns.has(column));
  if (!available.length || !searchText) return;

  values.push(`%${searchText}%`);
  const param = `$${values.length}`;

  conditions.push(
    "(" + available.map((column) => `${column} ILIKE ${param}`).join(" OR ") + ")"
  );
}

function buildBaseFilters(query, columns) {
  const conditions = [];
  const values = [];

  if (query.state && columns.has("state")) {
    pushCondition(conditions, values, `state = ?`, query.state);
  }

  if (query.donor_type && columns.has("donor_type")) {
    pushCondition(conditions, values, `donor_type = ?`, query.donor_type);
  }

  if (query.search) {
    addTextMatchAcrossColumns(
      ["donor_name", "relationship_strength"],
      columns,
      conditions,
      values,
      String(query.search).trim()
    );
  }

  return { conditions, values };
}

function buildCandidateSmartFilters(candidate, query, columns, baseConditions, baseValues) {
  const conditions = [...baseConditions];
  const values = [...baseValues];

  if (!candidate) {
    if (query.candidate_id && columns.has("candidate_id")) {
      pushCondition(conditions, values, `candidate_id = ?`, query.candidate_id);
    }

    return { conditions, values };
  }

  let addedCandidateSpecificFilter = false;

  if (columns.has("candidate_id")) {
    pushCondition(conditions, values, `candidate_id = ?`, candidate.candidate_id);
    addedCandidateSpecificFilter = true;
  }

  if (!addedCandidateSpecificFilter && candidate.name) {
    const nameColumns = [
      "candidate_name",
      "campaign_name",
      "recipient_name",
      "committee_name",
      "supported_candidate"
    ];

    const availableNameColumns = nameColumns.filter((column) => columns.has(column));

    if (availableNameColumns.length) {
      values.push(`%${candidate.name}%`);
      const param = `$${values.length}`;
      conditions.push(
        "(" + availableNameColumns.map((column) => `${column} ILIKE ${param}`).join(" OR ") + ")"
      );
      addedCandidateSpecificFilter = true;
    }
  }

  if (!addedCandidateSpecificFilter && candidate.state && columns.has("state")) {
    pushCondition(conditions, values, `state = ?`, candidate.state);
  }

  return { conditions, values };
}

async function queryDonorRows(whereClause, values, columns, limit) {
  const selectClause = buildSelectClause(columns);

  const donorsQuery = `
    SELECT
      ${selectClause}
    FROM donor_network
    ${whereClause}
    ORDER BY amount DESC NULLS LAST, donor_name ASC NULLS LAST
    LIMIT ${limit}
  `;

  const result = await pool.query(donorsQuery, values);
  return result.rows || [];
}

function buildSummary(rows) {
  const totalAmount = rows.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const stateTotals = rows.reduce((acc, row) => {
    const key = row.state || "Unknown";
    acc[key] = (acc[key] || 0) + Number(row.amount || 0);
    return acc;
  }, {});

  const topState =
    Object.entries(stateTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    total_donors: rows.length,
    total_amount: totalAmount,
    top_state: topState
  };
}

export async function getDonorNetwork(req, res) {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 25), 100));
    const columns = await getTableColumns("donor_network");

    if (!columns.size) {
      throw new Error("donor_network table not found");
    }

    const candidate = await getCandidateContext(req.query);
    const base = buildBaseFilters(req.query, columns);

    const exactOrSmart = buildCandidateSmartFilters(
      candidate,
      req.query,
      columns,
      base.conditions,
      base.values
    );

    let rows = await queryDonorRows(
      exactOrSmart.conditions.length
        ? `WHERE ${exactOrSmart.conditions.join(" AND ")}`
        : "",
      exactOrSmart.values,
      columns,
      limit
    );

    if (!rows.length && candidate?.state && columns.has("state")) {
      const fallbackConditions = [];
      const fallbackValues = [];

      pushCondition(fallbackConditions, fallbackValues, `state = ?`, candidate.state);

      if (req.query.donor_type && columns.has("donor_type")) {
        pushCondition(fallbackConditions, fallbackValues, `donor_type = ?`, req.query.donor_type);
      }

      rows = await queryDonorRows(
        `WHERE ${fallbackConditions.join(" AND ")}`,
        fallbackValues,
        columns,
        limit
      );
    }

    return res.json({
      results: rows,
      summary: buildSummary(rows),
      candidate: candidate
        ? {
            candidate_id: candidate.candidate_id,
            name: candidate.name,
            state: candidate.state,
            office: candidate.office,
            party: candidate.party
          }
        : null,
      demo: false
    });
  } catch (error) {
    console.error("getDonorNetwork fallback:", error.message);

    return res.json(demoDonorNetwork);
  }
}
