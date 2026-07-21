import { pool } from "../db/pool.js";


const clean = (v = "") => String(v ?? "").trim();

const obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};


export function createExecutiveMemoryService() {

  return {

    async read({ workspace_id = 1, user_id = null, question = "" }) {

      const { rows } = await pool.query(`SELECT id, workspace_id, user_id, question, summary, entities, confidence, evidence_status, created_at FROM executive_intelligence_memory WHERE workspace_id = $1 AND ($2::text IS NULL OR user_id = $2 OR user_id IS NULL) ORDER BY created_at DESC LIMIT 12`, [Number(workspace_id || 1), user_id ? String(user_id) : null]);

      return { question: clean(question), recent_items: rows };

    },

    async write({ workspace_id = 1, user_id = null, question = "", result = {} }) {

      const payload = obj(result);

      const { rows } = await pool.query(`INSERT INTO executive_intelligence_memory (workspace_id, user_id, question, summary, entities, confidence, evidence_status, payload) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb) RETURNING id, created_at`, [Number(workspace_id || 1), user_id ? String(user_id) : null, clean(question), clean(payload.executive_summary || payload.briefing?.executive_summary), JSON.stringify(obj(payload.entities)), Number(payload.confidence || 0), clean(payload.evidence_status || "unavailable"), JSON.stringify(payload)]);

      return rows[0] || null;

    },

  };

}

export default createExecutiveMemoryService;

