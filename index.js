import express from "express";
import pkg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ================= DB ================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================= HEALTH ================= */

app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres Enterprise API Running" });
});

/* ================= SEARCH ================= */

app.get("/api/search", async (req, res) => {

  const { q } = req.query;

  const result = await pool.query(
    `
    SELECT * FROM candidate
    WHERE name ILIKE $1
    LIMIT 50
    `,
    [`%${q}%`]
  );

  res.json(result.rows);
});

/* ================= STATE PAGE ================= */

app.get("/api/state/:state", async (req, res) => {

  const state = req.params.state.toUpperCase();

  const result = await pool.query(
    `
    SELECT * FROM candidate
    WHERE state = $1
    LIMIT 200
    `,
    [state]
  );

  res.json(result.rows);
});

/* ================= ADMIN IMPORT ================= */

app.post("/api/admin/import", async (req, res) => {

  const { candidates } = req.body;

  for (const c of candidates) {

    await pool.query(
      `
      INSERT INTO candidate (name, office, state, party, source)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [c.name, c.office, c.state, c.party, c.source || "manual"]
    );
  }

  res.json({ success: true });
});

/* ================= SAVE CANDIDATE ================= */

app.post("/api/save", async (req, res) => {

  const { user_id, candidate_id } = req.body;

  await pool.query(
    `
    INSERT INTO saved_candidates (user_id, candidate_id)
    VALUES ($1,$2)
    `,
    [user_id, candidate_id]
  );

  res.json({ saved: true });
});

/* ================= START ================= */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
