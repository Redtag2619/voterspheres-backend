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

/* ============================
   DATABASE
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

await pool.query("SELECT 1");
console.log("✅ Connected to database");

/* ============================
   AUTH MIDDLEWARE
============================ */

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.sendStatus(401);

  try{
    const t=h.split(" ")[1];
    req.user=jwt.verify(t,JWT_SECRET);
    next();
  }catch{
    res.sendStatus(401);
  }
}

function admin(req,res,next){
  if(req.user.role!=="admin") return res.sendStatus(403);
  next();
}

/* ============================
   AUTH ROUTES
============================ */

app.post("/api/auth/register", async(req,res)=>{
  const {email,password}=req.body;

  const hash=await bcrypt.hash(password,10);

  await pool.query(
    "INSERT INTO users(email,password) VALUES($1,$2)",
    [email,hash]
  );

  res.json({created:true});
});

app.post("/api/auth/login", async(req,res)=>{

  const {email,password}=req.body;

  const q=await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if(!q.rows.length || !q.rows[0].active)
    return res.sendStatus(401);

  const ok=await bcrypt.compare(password,q.rows[0].password);
  if(!ok) return res.sendStatus(401);

  const token=jwt.sign({
    id:q.rows[0].id,
    email,
    role:q.rows[0].role
  },JWT_SECRET,{expiresIn:"8h"});

  res.json({token});
});

/* ============================
   DROPDOWNS
============================ */

app.get("/api/dropdowns/states", async(req,res)=>{
  const q=await pool.query("SELECT id,name FROM states ORDER BY name");
  res.json(q.rows);
});

app.get("/api/dropdowns/counties", async(req,res)=>{
  const {state}=req.query;
  const q=await pool.query(
    "SELECT id,name FROM counties WHERE state_id=$1 ORDER BY name",
    [state]
  );
  res.json(q.rows);
});

app.get("/api/dropdowns/parties", async(req,res)=>{
  const q=await pool.query("SELECT id,name FROM parties ORDER BY name");
  res.json(q.rows);
});

app.get("/api/dropdowns/offices", async(req,res)=>{
  const q=await pool.query("SELECT id,name FROM offices ORDER BY name");
  res.json(q.rows);
});

app.get("/api/dropdowns/consultants", async(req,res)=>{
  const q=await pool.query("SELECT id,name FROM consultants ORDER BY name");
  res.json(q.rows);
});

app.get("/api/dropdowns/vendors", async(req,res)=>{
  const q=await pool.query("SELECT id,name FROM vendors ORDER BY name");
  res.json(q.rows);
});

/* ============================
   CANDIDATE SEARCH + PAGINATION
============================ */

app.get("/api/candidates", async(req,res)=>{

  const {q,state,county,party,office,page=1,limit=20}=req.query;

  let where=[];
  let values=[];

  if(q){
    values.push(`%${q}%`);
    where.push(`full_name ILIKE $${values.length}`);
  }

  if(state){
    values.push(state);
    where.push(`state_id=$${values.length}`);
  }

  if(county){
    values.push(county);
    where.push(`county_id=$${values.length}`);
  }

  if(party){
    values.push(party);
    where.push(`party_id=$${values.length}`);
  }

  if(office){
    values.push(office);
    where.push(`office_id=$${values.length}`);
  }

  const whereSQL = where.length ? "WHERE "+where.join(" AND ") : "";

  const offset=(page-1)*limit;

  const data=await pool.query(
    `SELECT * FROM candidates ${whereSQL} 
     ORDER BY full_name 
     LIMIT $${values.length+1} OFFSET $${values.length+2}`,
     [...values,limit,offset]
  );

  const count=await pool.query(
    `SELECT COUNT(*) FROM candidates ${whereSQL}`,
    values
  );

  res.json({
    results:data.rows,
    total:parseInt(count.rows[0].count),
    page:parseInt(page)
  });
});

/* ============================
   CSV EXPORT
============================ */

app.get("/api/export", auth, async(req,res)=>{

  const {state,county,party,office}=req.query;

  let w=[],v=[];

  if(state){v.push(state);w.push(`state_id=$${v.length}`);}
  if(county){v.push(county);w.push(`county_id=$${v.length}`);}
  if(party){v.push(party);w.push(`party_id=$${v.length}`);}
  if(office){v.push(office);w.push(`office_id=$${v.length}`);}

  const where=w.length?"WHERE "+w.join(" AND "):"";

  const q=await pool.query(
    `SELECT full_name,email,website FROM candidates ${where}`,
    v
  );

  let csv="name,email,website\n";

  q.rows.forEach(r=>{
    csv+=`${r.full_name},${r.email||""},${r.website||""}\n`;
  });

  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=candidates.csv");
  res.send(csv);
});

/* ============================
   ADMIN ROUTES
============================ */

app.get("/api/admin/users", auth, admin, async(req,res)=>{
  const q=await pool.query(
    "SELECT id,email,role,active FROM users ORDER BY id"
  );
  res.json(q.rows);
});

app.put("/api/admin/users/:id/disable", auth, admin, async(req,res)=>{
  await pool.query(
    "UPDATE users SET active=false WHERE id=$1",
    [req.params.id]
  );
  res.json({disabled:true});
});

app.delete("/api/admin/users/:id", auth, admin, async(req,res)=>{
  await pool.query(
    "DELETE FROM users WHERE id=$1",
    [req.params.id]
  );
  res.json({deleted:true});
});

/* ============================
   START
============================ */

app.listen(PORT,()=>{
  console.log("🚀 Backend running on port",PORT);
});
