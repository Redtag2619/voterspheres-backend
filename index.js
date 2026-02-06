import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";

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
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
}

testDB();

/* ============================
   AUTH MIDDLEWARE
============================ */

function adminOnly(req, res, next) {

  const auth = req.headers.authorization;

  if (!auth) return res.status(401).json({ error: "No token" });

  const token = auth.split(" ")[1];

  try {

    const user = jwt.verify(token, process.env.JWT_SECRET);

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }

    if (user.active === false) {
      return res.status(403).json({ error: "Account inactive" });
    }

    req.user = user;
    next();

  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ============================
   LOGIN
============================ */

app.post("/api/login", async (req, res) => {

  const { email, password } = req.body;

  try {

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid login" });
    }

    const user = result.rows[0];

    if (user.active === false) {
      return res.status(403).json({ error: "Account inactive" });
    }

    if (password !== user.password) {
      return res.status(401).json({ error: "Invalid login" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        active: user.active
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   FILE UPLOAD SETUP
============================ */

const uploadDir = "./uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }

});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Images only"));
      return;
    }
    cb(null, true);
  }
});

app.use("/uploads", express.static("uploads"));

/* ============================
   PHOTO UPLOAD (ADMIN)
============================ */

app.post(
  "/api/candidates/:id/photo",
  adminOnly,
  upload.single("photo"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({ error: "No file" });
      }

      await pool.query(
        "UPDATE candidates SET photo=$1 WHERE id=$2",
        [req.file.filename, req.params.id]
      );

      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ============================
   DROPDOWNS
============================ */

/* States */

app.get("/api/dropdowns/states", async (req, res) => {

  try {

    const { rows } = await pool.query(
      "SELECT DISTINCT state FROM candidates ORDER BY state"
    );

    res.json(rows.map(r => r.state));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Parties */

app.get("/api/dropdowns/parties", async (req, res) => {

  try {

    const { rows } = await pool.query(
      "SELECT DISTINCT party FROM candidates ORDER BY party"
    );

    res.json(rows.map(r => r.party));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Offices (FIXED — no offices table) */

app.get("/api/dropdowns/offices", async (req, res) => {

  try {

    const { rows } = await pool.query(
      "SELECT DISTINCT office FROM candidates ORDER BY office"
    );

    res.json(rows.map(r => r.office));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Counties (dynamic by state) */

app.get("/api/dropdowns/counties", async (req, res) => {

  const { state } = req.query;

  try {

    let query = "SELECT DISTINCT county FROM candidates";
    let params = [];

    if (state) {
      query += " WHERE state=$1";
      params.push(state);
    }

    query += " ORDER BY county";

    const { rows } = await pool.query(query, params);

    res.json(rows.map(r => r.county));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   SEARCH + PAGINATION
============================ */

app.get("/api/candidates", async (req, res) => {

  const {
    q,
    state,
    party,
    county,
    office,
    page = 1,
    limit = 20
  } = req.query;

  const offset = (page - 1) * limit;

  let where = [];
  let params = [];
  let i = 1;

  if (q) {
    where.push(`name ILIKE $${i++}`);
    params.push(`%${q}%`);
  }

  if (state) {
    where.push(`state=$${i++}`);
    params.push(state);
  }

  if (party) {
    where.push(`party=$${i++}`);
    params.push(party);
  }

  if (county) {
    where.push(`county=$${i++}`);
    params.push(county);
  }

  if (office) {
    where.push(`office=$${i++}`);
    params.push(office);
  }

  const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

  try {

    const data = await pool.query(
      `SELECT * FROM candidates ${whereSQL} 
       ORDER BY name 
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    const total = await pool.query(
      `SELECT COUNT(*) FROM candidates ${whereSQL}`,
      params
    );

    res.json({
      results: data.rows,
      total: Number(total.rows[0].count),
      page: Number(page)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   SERVER
============================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
