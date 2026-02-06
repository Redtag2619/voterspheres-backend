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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

/* =====================
   CANDIDATE PROFILE
===================== */

app.get("/api/candidate/:id", async (req,res)=>{

  const { id } = req.params;

  const result = await pool.query(`
    SELECT 
      c.id,
      c.full_name,
      c.email,
      c.phone,
      c.website,
      c.address,
      c.photo,
      s.name AS state,
      p.name AS party,
      co.name AS county,
      o.name AS office,
      c.created_at
    FROM candidate c
    LEFT JOIN state s ON c.state_id=s.id
    LEFT JOIN party p ON c.party_id=p.id
    LEFT JOIN county co ON c.county_id=co.id
    LEFT JOIN office o ON c.office_id=o.id
    WHERE c.id=$1
  `,[id]);

  if(result.rows.length===0){
    return res.status(404).json({error:"Candidate not found"});
  }

  res.json(result.rows[0]);
});

/* =====================
   DROPDOWNS
===================== */

app.get("/api/states", async (req,res)=>{
  const { rows } = await pool.query(`SELECT id,name FROM state ORDER BY name`);
  res.json(rows);
});

app.get("/api/parties", async (req,res)=>{
  const { rows } = await pool.query(`SELECT id,name FROM party ORDER BY name`);
  res.json(rows);
});

app.get("/api/offices", async (req,res)=>{
  const { rows } = await pool.query(`SELECT id,name FROM office ORDER BY name`);
  res.json(rows);
});

app.get("/api/counties", async (req,res)=>{
  const { state_id } = req.query;

  const { rows } = await pool.query(
    `SELECT id,name FROM county WHERE state_id=$1 ORDER BY name`,
    [state_id]
  );

  res.json(rows);
});

/* =====================
   PAGINATED SEARCH + TOTALS
===================== */

app.get("/api/search", async (req,res)=>{

  const {
    q,
    state_id,
    party_id,
    county_id,
    office_id,
    page=1,
    limit=20
  } = req.query;

  const offset = (page - 1) * limit;

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

  const filter = where.length ? "WHERE " + where.join(" AND ") : "";

  /* ---- TOTAL COUNT ---- */

  const totalResult = await pool.query(`
    SELECT COUNT(*) 
    FROM candidate c
    ${filter}
  `, vals);

  const total = parseInt(totalResult.rows[0].count);

  /* ---- PAGE DATA ---- */

  const dataResult = await pool.query(`
    SELECT 
      c.id,
      c.full_name,
      s.name AS state,
      p.name AS party,
      co.name AS county,
      o.name AS office
    FROM candidate c
    LEFT JOIN state s ON c.state_id=s.id
    LEFT JOIN party p ON c.party_id=p.id
    LEFT JOIN county co ON c.county_id=co.id
    LEFT JOIN office o ON c.office_id=o.id
    ${filter}
    ORDER BY c.full_name
    LIMIT $${i++} OFFSET $${i++}
  `,[...vals, limit, offset]);

  res.json({
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total/limit),
    results: dataResult.rows
  });
});

/* =====================
   START
===================== */

app.listen(PORT, ()=>{
  console.log("🚀 Backend running on",PORT);
});
