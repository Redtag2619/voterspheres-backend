import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();
const { Pool } = pkg;
const app = express();

/* ============================
   PATH FIX (ESM)
============================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================
   MIDDLEWARE
============================ */
app.use(cors());
app.use(express.json());

/* ============================
   STATIC FILES
============================ */
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

/* ============================
   AUTH MIDDLEWARE (ADMIN ONLY)
============================ */
const adminOnly = async (req, res, next) => {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { rows } = await pool.query(
    "SELECT is_admin FROM users WHERE id = $1",
    [userId]
  );

  if (!rows.length || !rows[0].is_admin) {
    return res.status(403).json({ error: "Admin only" });
  }

  next();
};

/* ============================
   MULTER CONFIG (SECURE)
============================ */
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `candidate-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Images only"));
    }
    cb(null, true);
  }
});

/* ============================
   HEALTH CHECK
============================ */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ============================
   CANDIDATES LIST
============================ */
app.get("/api/candidates", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.full_name,
      s.name AS state,
      p.name AS party,
      o.name AS office,
      c.photo
    FROM candidates c
    LEFT JOIN states s ON c.state_id = s.id
    LEFT JOIN parties p ON c.party_id = p.id
    LEFT JOIN offices o ON c.office_id = o.id
    ORDER BY c.full_name
  `);
  res.json(rows);
});

/* ============================
   ADMIN PHOTO UPLOAD
============================ */
app.post(
  "/api/admin/candidates/:id/photo",
  adminOnly,
  upload.single("photo"),
  async (req, res) => {
    const photoPath = `/uploads/${req.file.filename}`;

    await pool.query(
      "UPDATE candidates SET photo = $1 WHERE id = $2",
      [photoPath, req.params.id]
    );

    res.json({ success: true, photo: photoPath });
  }
);

/* ============================
   FRONTEND FALLBACK
============================ */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ============================
   START SERVER
============================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
