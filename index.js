import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
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
   IMAGE FOLDER
============================ */

const uploadDir = "./uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use("/uploads", express.static("uploads"));

/* ============================
   MULTER CONFIG
============================ */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

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
   SEARCH CANDIDATES
============================ */

app.get("/api/candidates", async (req, res) => {
  try {
    const { q = "", page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const dataQuery = `
      SELECT id, full_name, email, phone, website, photo
      FROM candidates
      WHERE full_name ILIKE $1
      ORDER BY full_name
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) FROM candidates
      WHERE full_name ILIKE $1
    `;

    const [data, count] = await Promise.all([
      pool.query(dataQuery, [`%${q}%`, limit, offset]),
      pool.query(countQuery, [`%${q}%`])
    ]);

    res.json({
      results: data.rows,
      total: Number(count.rows[0].count),
      page: Number(page),
      totalPages: Math.ceil(count.rows[0].count / limit)
    });

  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

/* ============================
   CANDIDATE PROFILE
============================ */

app.get("/api/candidates/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM candidates WHERE id=$1",
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Profile failed" });
  }
});

/* ============================
   UPLOAD CANDIDATE PHOTO
============================ */

app.post(
  "/api/candidates/:id/photo",
  upload.single("photo"),
  async (req, res) => {
    try {
      const filename = req.file.filename;

      await pool.query(
        "UPDATE candidates SET photo=$1 WHERE id=$2",
        [filename, req.params.id]
      );

      res.json({ success: true, photo: filename });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

/* ============================
   SERVER
============================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
