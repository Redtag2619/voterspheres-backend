import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* =====================
   DATABASE
===================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

/* =====================
   TEST
===================== */

async function testDB() {
  const { rows } = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema='public'
  `);

  console.log("📦 Tables:", rows.map(r => r.table_name));
}

testDB();

/* =====================
   DROPDOWNS
===================== */

app.get("/api/states", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id,name FROM public.state ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/parties", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id,name FROM public.party ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/offices", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id,name FROM public.office ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/counties", async (req,res)=>{
  const { state_id } = req.query;

  const { rows } = await pool.query(
    "SELECT id,name FROM public.county WHERE state_id=$1 ORDER BY name",
    [state_id]
  );

  res.json(rows);
});

/* =====================
   ALL CANDIDATES
===================== */

app.get("/api/candidates", async (req,res)=>{
  const { rows } = await pool.query(`
    SELECT 
      c.id,
      c.full_name,
      s.name AS state,
      p.name AS party,
      co.name AS county,
      o.name AS office
    FROM public.candidate c
    LEFT JOIN public.state s ON c.state_id=s.id
    LEFT JOIN public.party p ON c.party_id=p.id
    LEFT JOIN public.county co ON c.county_id=co.id
    LEFT JOIN public.office o ON c.office_id=o.id
    ORDER BY c.full_name
    LIMIT 100
  `);

  res.json(rows);
});

/* =====================
   SEARCH
===================== */

app.get("/api/search", async (req,res)=>{
  const { q, state_id, party_id, county_id, office_id } = req.query;

  let where=[];
  let vals=[];
  let i=1;

  if(q){
    where.push(`c.full_name ILIKE $${i++}`);
    vals.push(`%${q}%`);
  }
  if(state_id){
    where.push(`c.state_id=$${i++}`);
    vals.push(state_id);
  }
  if(party_id){
    where.push(`c.party_id=$${i++}`);
    vals.push(party_id);
  }
  if(county_id){
    where.push(`c.county_id=$${i++}`);
    vals.push(county_id);
  }
  if(office_id){
    where.push(`c.office_id=$${i++}`);
    vals.push(office_id);
  }

  const filter = where.length ? "WHERE "+where.join(" AND ") : "";

  const { rows } = await pool.query(`
    SELECT 
      c.id,
      c.full_name,
      s.name AS state,
      p.name AS party,
      co.name AS county,
      o.name AS office
    FROM public.candidate c
    LEFT JOIN public.state s ON c.state_id=s.id
    LEFT JOIN public.party p ON c.party_id=p.id
    LEFT JOIN public.county co ON c.county_id=co.id
    LEFT JOIN public.office o ON c.office_id=o.id
    ${filter}
    ORDER BY c.full_name
    LIMIT 100
  `, vals);

  res.json(rows);
});

/* =====================
   START
===================== */

app.listen(PORT, ()=>{
  console.log("🚀 Backend running on", PORT);
});
