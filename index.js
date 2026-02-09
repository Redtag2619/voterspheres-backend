import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";

dotenv.config();
const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 10000;

/* -------------------- MIDDLEWARE -------------------- */
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------- DATABASE -------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

/* -------------------- UPLOADS -------------------- */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
app.use("/uploads", express.static(UPLOAD_DIR));

/* -------------------- AUTH -------------------- */
function adminOnly(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.sendStatus(401);

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.is_admin) return res.sendStatus(403);
    req.user = decoded;
    next();
  } catch {
    res.sendStatus(401);
  }
}

/* -------------------- LOGIN -------------------- */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT id, password_hash, is_admin FROM public.users WHERE email=$1",
    [email]
  );

  if (!result.rows.length) return res.sendStatus(401);

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.sendStatus(401);

  const token = jwt.sign(
    { id: user.id, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

/* -------------------- MULTER (SECURE) -------------------- */
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safeName =
      Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.]/g, "");
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Images only"));
    }
    cb(null, true);
  },
});

/* -------------------- ADMIN PHOTO UPLOAD -------------------- */
app.post(
  "/api/admin/candidate/:id/photo",
  adminOnly,
  upload.single("photo"),
  async (req, res) => {
    try {
      const photoPath = `/uploads/${req.file.filename}`;

      await pool.query(
        "UPDATE public.candidate SET photo=$1 WHERE id=$2",
        [photoPath, req.params.id]
      );

      res.json({ success: true, photo: photoPath });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

/* -------------------- SERVER -------------------- */
app.listen(PORT, "0.0.0.0", async () => {
  await pool.query("SELECT 1");
  console.log(`🚀 Backend running on ${PORT}`);
});
