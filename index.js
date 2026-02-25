import express from "express";
import compression from "compression";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import slugify from "slugify";

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || "https://www.votersphere.org";

/* ================================
   DATABASE
================================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================================
   TEST DB CONNECTION
================================ */

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
}

testDB();

/* ================================
   MIDDLEWARE
================================ */

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());

/* ================================
   HEALTH CHECK
================================ */

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ================================
   FETCH LIVE DATA (NO AXIOS NEEDED)
================================ */

async function fetchJSON(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fetch error ${response.status}`);
  }

  return response.json();
}

/* ================================
   SAMPLE IMPORT ROUTE
================================ */

app.get("/admin/import-test", async (req, res) => {
  try {
    const data = await fetchJSON(
      "https://api.sampleapis.com/futurama/characters"
    );

    res.json({
      imported: data.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

/* ================================
   ROOT
================================ */

app.get("/", (req, res) => {
  res.send("🚀 VoterSphere Backend Running");
});

/* ================================
   START SERVER
================================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
