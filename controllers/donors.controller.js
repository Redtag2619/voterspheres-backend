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
    },
    {
      id: 2,
      donor_name: "Keystone Civic Network",
      donor_type: "Individual Network",
      state: "Pennsylvania",
      amount: 175000,
      relationship_strength: "Medium",
    },
    {
      id: 3,
      donor_name: "Great Lakes Action Council",
      donor_type: "PAC",
      state: "Michigan",
      amount: 120000,
      relationship_strength: "Growing",
    },
  ],
  summary: {
    total_donors: 3,
    total_amount: 545000,
    top_state: "Georgia",
  },
  demo: true,
};

function buildWhereClause(query = {}) {
  const conditions = [];
  const values = [];

  if (query.state) {
    values.push(query.state);
    conditions.push(`state = $${values.length}`);
  }

  if (query.donor_type) {
    values.push(query.donor_type);
    conditions.push(`donor_type = $${values.length}`);
  }

  if (query.search) {
    values.push(`%${query.search}%`);
    conditions.push(
      `(donor_name ILIKE $${values.length} OR relationship_strength ILIKE $${values.length})`
    );
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return { whereClause, values };
}

export async function getDonorNetwork(req, res) {
  try {
    const { whereClause, values } = buildWhereClause(req.query);

    const donorsQuery = `
      SELECT
        id,
        donor_name,
        donor_type,
        state,
        amount,
        relationship_strength
      FROM donor_network
      ${whereClause}
      ORDER BY amount DESC NULLS LAST, donor_name ASC
    `;

    const result = await pool.query(donorsQuery, values);

    const rows = result.rows || [];

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

    return res.json({
      results: rows,
      summary: {
        total_donors: rows.length,
        total_amount: totalAmount,
        top_state: topState,
      },
      demo: false,
    });
  } catch (error) {
    console.error("getDonorNetwork fallback:", error.message);

    return res.json(demoDonorNetwork);
  }
}
