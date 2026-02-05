import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "secret123";

/* ===========================
   DATABASE
=========================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

async function testDB(){
  try{
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  }catch(err){
    console.error("❌ DB ERROR:", err);
  }
}

testDB();

/* ===========================
   AUTH MIDDLEWARE
=========================== */

function auth(req,res,next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({error:"No token"});

  const token = header.split(" ")[1];

  try{
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  }catch{
    res.status(401).json({error:"Invalid token"});
  }
}

/* ===========================
   AUTH ROUTES
=========================== */

app.post("/api/auth/register", async (req,res)=>{
  const { email, password } = req.body;

  const hash = await bcrypt.hash(password,10);

  try{
    await pool.query(
      "INSERT INTO users(email,password) VALUES($1,$2)",
      [email,hash]
    );
    res.json({message:"User created"});
  }catch(err){
    res.status(400).json({error:"User exists"});
  }
});

app.post("/api/auth/login", async (req,res)=>{
  const { email, password } = req.body;

  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email=$1",[email]
  );

  if(!rows.length)
    return res.status(401).json({error:"Invalid login"});

  const user = rows[0];

  const ok = await bcrypt.compare(password,user.password);
  if(!ok)
    return res.status(401).json({error:"Invalid login"});

  const token = jwt.sign(
    { id:user.id, email:user.email },
    JWT_SECRET,
    { expiresIn:"8h" }
  );

  res.json({ token });
});

app.get("/api/profile", auth, (req,res)=>{
  res.json(req.user);
});

/* ===========================
   DROPDOWNS
=========================== */

app.get("/api/dropdowns/states", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT DISTINCT state FROM candidates ORDER BY state"
  );
  res.json(rows);
});

app.get("/api/dropdowns/counties", async (req,res)=>{
  const { state } = req.query;

  const { rows } = await pool.query(
    "SELECT DISTINCT county FROM candidates WHERE state=$1 ORDER BY county",
    [state]
  );
  res.json(rows);
});

/* ===========================
   PROTECTED SEARCH API
=========================== */

app.get("/api/search", auth, async (req,res)=>{

  const {
    state,
    county,
    party,
    office,
    page = 1,
    limit = 20
  } = req.query;

  let where = [];
  let values = [];

  if(state){
    values.push(state);
    where.push(`state=$${values.length}`);
  }

  if(county){
    values.push(county);
    where.push(`county=$${values.length}`);
  }

  if(party){
    values.push(party);
    where.push(`party=$${values.length}`);
  }

  if(office){
    values.push(office);
    where.push(`office=$${values.length}`);
  }

  const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

  const offset = (page-1)*limit;

  const dataQuery = `
    SELECT * FROM candidates
    ${whereSQL}
    LIMIT $${values.length+1}
    OFFSET $${values.length+2}
  `;

  const countQuery = `
    SELECT COUNT(*) FROM candidates ${whereSQL}
  `;

  const data = await pool.query(dataQuery, [...values, limit, offset]);
  const count = await pool.query(countQuery, values);

  res.json({
    rows: data.rows,
    total: parseInt(count.rows[0].count),
    page: parseInt(page),
    pages: Math.ceil(count.rows[0].count/limit)
  });
});

/* ===========================
   SERVER
=========================== */

app.listen(PORT, ()=>{
  console.log("🚀 Backend running on port",PORT);
});
