import express from "express";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import multer from "multer";
import fs from "fs";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

/* ========================= */
/* DATABASE */
/* ========================= */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

/* ========================= */
/* MIDDLEWARE */
/* ========================= */
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.static("public")); // frontend files

/* ========================= */
/* ADMIN AUTH */
/* ========================= */
function adminOnly(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* ========================= */
/* MULTER (SECURE) */
/* ========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.]/gi, "_");
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Images only"));
    }
    cb(null, true);
  }
});

/* ========================= */
/* API ROUTES */
/* ========================= */
app.get("/candidates", async (req, res) => {
  const page = parseInt(req.query.page || "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  const total = await pool.query(
    "SELECT COUNT(*) FROM candidate"
  );

  const results = await pool.query(
    `SELECT id, full_name, slug, office, party
     FROM candidate
     ORDER BY full_name
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  res.json({
    page,
    total: Number(total.rows[0].count),
    results: results.rows
  });
});

app.get("/candidate/:slug", async (req, res) => {
  const { slug } = req.params;

  const result = await pool.query(
    `SELECT *
     FROM candidate
     WHERE slug = $1
     LIMIT 1`,
    [slug]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json(result.rows[0]);
});

/* ========================= */
/* ADMIN PHOTO UPLOAD */
/* ========================= */
app.post(
  "/admin/candidate/:id/photo",
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

/* ========================= */
/* SLUGLESS FALLBACK */
/* ========================= */
/* ANY non-API route loads index.html */
app.get("*", (req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

/* ========================= */
app.listen(PORT, () =>
  console.log(`🚀 Running on ${PORT}`)
);
