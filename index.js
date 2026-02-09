import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";

dotenv.config();
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;

/* ───────────────────────────────────────────── */
/* BASIC APP SETUP */
/* ───────────────────────────────────────────── */
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

/* health check (fixes console 404 spam) */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ───────────────────────────────────────────── */
/* DATABASE */
/* ───────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect()
  .then(() => console.log("✅ Connected to database"))
  .catch(err => {
    console.error("❌ DB connection error", err);
    process.exit(1);
  });

/* ───────────────────────────────────────────── */
/* AUTH + ADMIN MIDDLEWARE */
/* ───────────────────────────────────────────── */
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
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

/* ───────────────────────────────────────────── */
/* LOGIN (BLOCK INACTIVE USERS) */
/* ───────────────────────────────────────────── */
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1 LIMIT 1",
    [email]
  );

  const user = result.rows[0];
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

/* ───────────────────────────────────────────── */
/* MULTER (SECURE PHOTO UPLOAD) */
/* ───────────────────────────────────────────── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/candidates";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.]/gi, "_").toLowerCase();
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Images only"));
    }
    cb(null, true);
  },
});

/* ───────────────────────────────────────────── */
/* CANDIDATE LIST + PAGINATION */
/* ───────────────────────────────────────────── */
app.get("/candidates", async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  const totalResult = await pool.query(
    "SELECT COUNT(*) FROM public.candidate"
  );

  const result = await pool.query(
    `
    SELECT
      id,
      full_name,
      slug,
      state,
      party,
      county,
      office,
      photo
    FROM public.candidate
    ORDER BY full_name
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  res.json({
    total: Number(totalResult.rows[0].count),
    page,
    results: result.rows,
  });
});

/* ───────────────────────────────────────────── */
/* CANDIDATE PROFILE (SLUG URL) */
/* ───────────────────────────────────────────── */
app.get("/candidate/:slug", async (req, res) => {
  const { slug } = req.params;

  const result = await pool.query(
    `
    SELECT
      id,
      full_name,
      slug,
      state,
      party,
      county,
      office,
      photo
    FROM public.candidate
    WHERE slug = $1
    LIMIT 1
    `,
    [slug]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Candidate not found" });
  }

  res.json(result.rows[0]);
});

/* ───────────────────────────────────────────── */
/* ADMIN PHOTO UPLOAD */
/* ───────────────────────────────────────────── */
app.post(
  "/admin/candidate/:id/photo",
  authenticate,
  adminOnly,
  upload.single("photo"),
  async (req, res) => {
    const { id } = req.params;
    const photoPath = `/uploads/candidates/${req.file.filename}`;

    await pool.query(
      "UPDATE public.candidate SET photo = $1 WHERE id = $2",
      [photoPath, id]
    );

    res.json({ success: true, photo: photoPath });
  }
);

/* ───────────────────────────────────────────── */
/* START SERVER */
/* ───────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
