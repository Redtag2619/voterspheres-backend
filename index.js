import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ============================
   DATABASE
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB ERROR:", err);
  }
}

testDB();

/* ============================
   SEARCH CANDIDATES (LIST)
============================ */

app.get("/api/candidates", async (req, res) => {
  try {
    const {
      q = "",
      state,
      party,
      county,
      office,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (page - 1) * limit;

    let where = `WHERE full_name ILIKE $1`;
    let values = [`%${q}%`];
    let idx = 2;

    if (state) {
      where += ` AND state_id = $${idx++}`;
      values.push(state);
    }

    if (party) {
      where += ` AND party_id = $${idx++}`;
      values.push(party);
    }

    if (county) {
      where += ` AND county_id = $${idx++}`;
      values.push(county);
    }

    if (office) {
      where += ` AND office_id = $${idx++}`;
      values.push(office);
    }

    const dataQuery = `
      SELECT id, full_name, email, phone, website
      FROM candidates
      ${where}
      ORDER BY full_name
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    values.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) FROM candidates ${where}
    `;

    const [data, count] = await Promise.all([
      pool.query(dataQuery, values),
      pool.query(countQuery, values.slice(0, values.length - 2))
    ]);

    res.json({
      results: data.rows,
      total: Number(count.rows[0].count),
      page: Number(page),
      totalPages: Math.ceil(count.rows[0].count / limit)
    });

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* ============================
   CANDIDATE PROFILE ROUTE
============================ */

app.get("/api/candidates/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        c.*,
        s.name AS state_name,
        co.name AS county_name,
        o.name AS office_name,
        p.name AS party_name
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN offices o ON c.office_id = o.id
      LEFT JOIN parties p ON c.party_id = p.id
      WHERE c.id = $1
    `;

    const { rows } = await pool.query(query, [id]);

    if (!rows.length) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error("PROFILE ERROR:", err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

/* ============================
   SERVER
============================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
