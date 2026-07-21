import { pool } from "../db/pool.js";

const clean = (v = "") => String(v ?? "").trim();

async function safeQuery(sql, params = [], queryName = "executive-fabric-query") {
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } catch (error) {
    console.error(`[Executive Fabric] ${queryName} failed`, {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
      sql: String(sql).replace(/\s+/g, " ").trim().slice(0, 500),
      params
    });

    return [];
  }
}

const sources = (rows, provider, title = "name") => rows.map((row) => ({ provider, name: clean(row[title] || row.name || provider), title: clean(row[title] || row.name || provider), published_at: row.updated_at || row.created_at || null, excerpt: clean(row.summary || row.description || row.status), relevance_score: 82 }));

export function createExecutiveFabricAdapters() {

  return {

    candidate: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT id,name,office,state,party,status,updated_at FROM candidates WHERE workspace_id=$1 AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR name ILIKE '%'||$3||'%') ORDER BY updated_at DESC NULLS LAST LIMIT 12`, [Number(workspace_id || 1), entities.state, entities.candidate]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} candidate records matched.` : "No candidate records matched.", data: { candidates: rows }, sources: sources(rows, "VoterSpheres Candidate Intelligence") }; },

    fec: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT candidate_id,committee_id,cycle,receipts,disbursements,cash_on_hand,debts,coverage_through_date,updated_at FROM candidate_finance_summary WHERE workspace_id=$1 AND ($2::text IS NULL OR candidate_id=$2) AND ($3::text IS NULL OR cycle::text=$3) ORDER BY coverage_through_date DESC NULLS LAST LIMIT 12`, [Number(workspace_id || 1), entities.candidate_id ? String(entities.candidate_id) : null, entities.cycle]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} finance summaries retrieved.` : "No finance summaries matched.", data: { finance: rows }, sources: rows.map((row) => ({ provider: "Federal Election Commission / VoterSpheres", name: `Finance summary ${row.candidate_id || row.committee_id || ""}`.trim(), published_at: row.updated_at || row.coverage_through_date, excerpt: `Receipts ${row.receipts || 0}; cash on hand ${row.cash_on_hand || 0}.`, reliability_score: 98, relevance_score: 92 })) }; },

    polling: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT id,state,office,pollster,candidate_name,pct,field_start,field_end,sample_size,updated_at FROM polling_results WHERE workspace_id=$1 AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR office ILIKE '%'||$3||'%') ORDER BY field_end DESC NULLS LAST LIMIT 20`, [Number(workspace_id || 1), entities.state, entities.office]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} polling observations retrieved.` : "No polling observations matched.", data: { polls: rows }, sources: rows.map((row) => ({ provider: row.pollster || "Polling Intelligence", name: `${row.pollster || "Poll"} ${row.state || ""}`.trim(), published_at: row.field_end || row.updated_at, excerpt: `${row.candidate_name || "Candidate"}: ${row.pct ?? "n/a"}%.`, reliability_score: 82, relevance_score: 90 })) }; },

    forecast: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT id,state,office,candidate_name,win_probability,projected_margin,rating,updated_at FROM election_forecasts WHERE workspace_id=$1 AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR office ILIKE '%'||$3||'%') ORDER BY updated_at DESC NULLS LAST LIMIT 12`, [Number(workspace_id || 1), entities.state, entities.office]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} forecast records retrieved.` : "No forecast records matched.", data: { forecasts: rows }, sources: sources(rows, "VoterSpheres Forecast Engine", "candidate_name") }; },

    news: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT id,title,source,url,published_at,summary,state,updated_at FROM political_news WHERE workspace_id=$1 AND ($2::text IS NULL OR state=$2 OR state IS NULL) ORDER BY published_at DESC NULLS LAST LIMIT 20`, [Number(workspace_id || 1), entities.state]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} political news records retrieved.` : "No political news records matched.", data: { articles: rows }, sources: rows.map((row) => ({ provider: row.source || "Political News", name: row.title, title: row.title, url: row.url, published_at: row.published_at || row.updated_at, excerpt: row.summary, reliability_score: 78, relevance_score: 84 })) }; },

    state: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT state_code,locality_name,locality_type,population,strategic_priority,risk_level,updated_at FROM state_localities WHERE workspace_id=$1 AND ($2::text IS NULL OR state_code=$2) AND ($3::text IS NULL OR locality_name ILIKE '%'||$3||'%') ORDER BY population DESC NULLS LAST LIMIT 25`, [Number(workspace_id || 1), entities.state, entities.locality]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} state or locality records retrieved.` : "No state or locality records matched.", data: { localities: rows }, sources: sources(rows, "U.S. Census / VoterSpheres State Intelligence", "locality_name") }; },

    consultant: async ({ entities, workspace_id }) => { const rows = await safeQuery(`SELECT id,name,categories,states,coverage_score,tier,risk_level,updated_at FROM vendors WHERE workspace_id=$1 AND ($2::text IS NULL OR $2=ANY(states)) ORDER BY coverage_score DESC NULLS LAST LIMIT 20`, [Number(workspace_id || 1), entities.state]); return { ok: true, meaningful: rows.length > 0, summary: rows.length ? `${rows.length} consultant or vendor records retrieved.` : "No consultant or vendor records matched.", data: { vendors: rows }, sources: sources(rows, "VoterSpheres Consultant Intelligence") }; },

  };

}

export default createExecutiveFabricAdapters;


