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

/* ================= DB ================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV==="production"
    ? { rejectUnauthorized:false }
    : false
});

await pool.query("SELECT 1");

/* ================= AUTH ================= */

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.sendStatus(401);
  try{
    req.user=jwt.verify(h.split(" ")[1],JWT_SECRET);
    next();
  }catch{res.sendStatus(401);}
}

app.post("/api/auth/register", async(req,res)=>{
  const {email,password}=req.body;
  const hash=await bcrypt.hash(password,10);
  await pool.query(
    "INSERT INTO users(email,password) VALUES($1,$2)",
    [email,hash]
  );
  res.json({ok:true});
});

app.post("/api/auth/login", async(req,res)=>{
  const {email,password}=req.body;
  const q=await pool.query("SELECT * FROM users WHERE email=$1",[email]);
  if(!q.rows.length) return res.sendStatus(401);

  const ok=await bcrypt.compare(password,q.rows[0].password);
  if(!ok) return res.sendStatus(401);

  const token=jwt.sign(
    {id:q.rows[0].id,email},
    JWT_SECRET,
    {expiresIn:"8h"}
  );
  res.json({token});
});

/* ================= DROPDOWNS ================= */

app.get("/api/dropdowns/states", async(req,res)=>{
  const q=await pool.query(
    "SELECT DISTINCT state FROM candidates ORDER BY state"
  );
  res.json(q.rows);
});

app.get("/api/dropdowns/counties", async(req,res)=>{
  const q=await pool.query(
    "SELECT DISTINCT county FROM candidates WHERE state=$1 ORDER BY county",
    [req.query.state]
  );
  res.json(q.rows);
});

/* ================= SEARCH ================= */

app.get("/api/search", auth, async(req,res)=>{

  const {state,county,party,office,page=1}=req.query;

  let w=[],v=[];

  if(state){v.push(state);w.push(`state=$${v.length}`);}
  if(county){v.push(county);w.push(`county=$${v.length}`);}
  if(party){v.push(party);w.push(`party=$${v.length}`);}
  if(office){v.push(office);w.push(`office=$${v.length}`);}

  const where=w.length?"WHERE "+w.join(" AND "):"";
  const limit=20;
  const offset=(page-1)*limit;

  const data=await pool.query(
    `SELECT * FROM candidates ${where} LIMIT $${v.length+1} OFFSET $${v.length+2}`,
    [...v,limit,offset]
  );

  const count=await pool.query(
    `SELECT COUNT(*) FROM candidates ${where}`,v
  );

  res.json({
    rows:data.rows,
    pages:Math.ceil(count.rows[0].count/limit),
    total:parseInt(count.rows[0].count)
  });
});

/* ================= FAVORITES ================= */

app.post("/api/favorites/:id", auth, async(req,res)=>{
  await pool.query(
    "INSERT INTO favorites(user_id,candidate_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [req.user.id, req.params.id]
  );
  res.json({saved:true});
});

app.delete("/api/favorites/:id", auth, async(req,res)=>{
  await pool.query(
    "DELETE FROM favorites WHERE user_id=$1 AND candidate_id=$2",
    [req.user.id, req.params.id]
  );
  res.json({removed:true});
});

app.get("/api/favorites", auth, async(req,res)=>{
  const q=await pool.query(`
    SELECT c.* FROM favorites f
    JOIN candidates c ON c.id=f.candidate_id
    WHERE f.user_id=$1
  `,[req.user.id]);

  res.json(q.rows);
});

/* ================= SAVED SEARCHES ================= */

app.post("/api/saved-searches", auth, async(req,res)=>{
  const {state,county,party,office}=req.body;

  await pool.query(`
    INSERT INTO saved_searches
    (user_id,state,county,party,office)
    VALUES($1,$2,$3,$4,$5)
  `,[req.user.id,state,county,party,office]);

  res.json({saved:true});
});

app.get("/api/saved-searches", auth, async(req,res)=>{
  const q=await pool.query(
    "SELECT * FROM saved_searches WHERE user_id=$1 ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json(q.rows);
});

/* ================= SERVER ================= */

app.listen(PORT,()=>{
  console.log("🚀 Backend running",PORT);
});
