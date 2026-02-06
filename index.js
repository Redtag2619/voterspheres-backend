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
  ssl: process.env.NODE_ENV === "production"
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

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }

    if (decoded.active === false) {
      return res.status(403).json({ error: "User inactive" });
    }

    req.user = decoded;
    next();

  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ============================
   LOGIN ROUTE
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

/* ===== BONUS SECURITY ===== */

const upload = multer({

  storage,

  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB max
  },

  fileFilter(req, file, cb) {

    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files allowed"));
      return;
    }

    cb(null, true);
  }

});

/* ============================
   SERVE PHOTOS
============================ */

app.use("/uploads", express.static("uploads"));

/* ============================
   SECURE PHOTO UPLOAD
============================ */

app.post(
  "/api/candidates/:id/photo",
  adminOnly,
  upload.single("photo"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const filename = req.file.filename;

      await pool.query(
        "UPDATE candidates SET photo=$1 WHERE id=$2",
        [filename, req.params.id]
      );

      res.json({
        success: true,
        photo: filename
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

/* ============================
   SAMPLE SEARCH (OPTIONAL)
============================ */

app.get("/api/candidates", async (req, res) => {

  const { page = 1, limit = 20 } = req.query;

  const offset = (page - 1) * limit;

  try {

    const data = await pool.query(
      "SELECT * FROM candidates ORDER BY id LIMIT $1 OFFSET $2",
      [limit, offset]
    );

    const total = await pool.query(
      "SELECT COUNT(*) FROM candidates"
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
   START SERVER
============================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
