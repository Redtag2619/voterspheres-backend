import { pool } from "../db/pool.js";

const demoConsultants = {
  results: [
    {
      id: 1,
      name: "Red Tag Strategies",
      category: "General Consulting",
      state: "Louisiana",
      website: "https://example.com",
      status: "active",
    },
    {
      id: 2,
      name: "Capitol Campaign Group",
      category: "Media + Strategy",
      state: "Georgia",
      website: "https://example.com",
      status: "active",
    },
    {
      id: 3,
      name: "Keystone Field Partners",
      category: "Field Operations",
      state: "Pennsylvania",
      website: "https://example.com",
      status: "active",
    },
  ],
  demo: true,
};

function buildWhereClause(query = {}) {
  const conditions = [];
  const values = [];

  if (query.state) {
    values.push(query.state);
    conditions.push(`state = $${values.length}`);
  }

  if (query.category) {
    values.push(query.category);
    conditions.push(`category = $${values.length}`);
  }

  if (query.status) {
    values.push(query.status);
    conditions.push(`status = $${values.length}`);
  }

  if (query.search) {
    values.push(`%${query.search}%`);
    conditions.push(
      `(name ILIKE $${values.length} OR category ILIKE $${values.length} OR state ILIKE $${values.length})`
    );
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return { whereClause, values };
}

export async function getConsultants(req, res) {
  try {
    const { whereClause, values } = buildWhereClause(req.query);

    const consultantsQuery = `
      SELECT
        id,
        name,
        category,
        state,
        website,
        status
      FROM consultants
      ${whereClause}
      ORDER BY name ASC
    `;

    const result = await pool.query(consultantsQuery, values);

    return res.json({
      results: result.rows || [],
      demo: false,
    });
  } catch (error) {
    console.error("getConsultants fallback:", error.message);

    return res.json(demoConsultants);
  }
}

export async function getConsultantStates(req, res) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state
      FROM consultants
      WHERE state IS NOT NULL AND TRIM(state) <> ''
      ORDER BY state ASC
    `);

    return res.json({
      states: result.rows.map((row) => row.state),
      demo: false,
    });
  } catch (error) {
    console.error("getConsultantStates fallback:", error.message);

    return res.json({
      states: ["Georgia", "Louisiana", "Pennsylvania"],
      demo: true,
    });
  }
}
