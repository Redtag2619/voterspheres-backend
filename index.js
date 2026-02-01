import express from "express";
import cors from "cors";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();

/* =========================
   Config
========================= */

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

/* =========================
   Middleware
========================= */

app.use(cors());
app.use(express.json());

/* =========================
   PostgreSQL
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

/* =========================
   Health Check
========================= */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   AUTH ROUTES
========================= */

// Register
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users(email, password_hash) VALUES($1,$2) RETURNING id,email",
      [email, hash]
    );

    res.json({ user: result.rows[0] });

  } catch (err) {
    res.status(400).json({ error: "User already exists" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if (result.rows.length === 0)
    return res.status(401).json({ error: "Invalid credentials" });

  const user = result.rows[0];

  const match = await bcrypt.compare(password, user.password_hash);

  if (!match)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.json({ token });
});

/* =========================
   Auth Middleware
========================= */

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  const token = header.split(" ")[1];

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* =========================
   Protected Example
========================= */

app.get("/api/secure-data", auth, (req, res) => {
  res.json({
    message: "Protected info",
    user: req.user
  });
});

/* =========================
   Voters API
========================= */

app.get("/api/voters", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM voters LIMIT 100"
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load voters" });
  }
});

/* =========================
   Start Server
========================= */

app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
