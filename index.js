import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* =========================
   DATABASE
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (e) {
    console.error("❌ DB ERROR", e);
  }
})();

/* =========================
   AUTH MIDDLEWARE
========================= */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* =========================
   LOGIN
========================= */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if (!rows.length) return res.status(401).json({ error: "Invalid login" });
  if (!rows[0].active) return res.status(403).json({ error: "Account inactive" });

  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid login" });

  const token = jwt.sign(
    { id: rows[0].id, role: rows[0].role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, role: rows[0].role });
});

/* =========================
   FILE UPLOAD CONFIG
========================= */
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `candidate_${req.params.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Images only"));
    }
    cb(null, true);
  }
});

/* =========================
   SERVE UPLOADS
========================= */
app.use("/uploads", express.static("uploads"));

/* =========================
   ADMIN PHOTO UPLOAD
========================= */
app.post(
  "/api/admin/candidate/:id/photo",
  authMiddleware,
  adminOnly,
  upload.single("photo"),
  async (req, res) => {
    const photoPath = `/uploads/${req.file.filename}`;

    await pool.query(
      "UPDATE candidate SET photo=$1 WHERE id=$2",
      [photoPath, req.params.id]
    );

    res.json({ success: true, photo: photoPath });
  }
);

/* =========================
   CANDIDATE LIST
========================= */
app.get("/api/candidates", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.full_name, s.name AS state, p.name AS party,
           co.name AS county, o.name AS office, c.photo
    FROM candidate c
    LEFT JOIN states s ON c.state_id=s.id
    LEFT JOIN parties p ON c.party_id=p.id
    LEFT JOIN counties co ON c.county_id=co.id
    LEFT JOIN offices o ON c.office_id=o.id
    ORDER BY c.full_name
  `);
  res.json(rows);
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
