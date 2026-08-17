import "dotenv/config";
import { pool } from "../db/pool.js";
import { getCandidateIntelligenceBundle } from "../services/candidateIntelligenceBundle.service.js";

const candidate = process.argv[2] || "Jasmine Crockett";
const state = process.argv[3] || "TX";
const office = process.argv[4] || "";
const cycle = Number(process.argv[5] || new Date().getFullYear());

try {
  const result = await getCandidateIntelligenceBundle({
    candidate,
    state,
    office,
    cycle,
    workspaceId: 1,
    limit: 12,
    user: { id: 1, firm_id: 1 },
  });
  console.log(JSON.stringify({
    ok: result.ok,
    build: result.build,
    candidate: result.candidate,
    evidence_status: result.evidence_status,
    confidence: result.confidence,
    identities: result.identities?.length || 0,
    finance: result.finance?.length || 0,
    polling: result.polling?.records?.length || 0,
    news: result.news?.length || 0,
    signals: result.signals?.length || 0,
    warnings: result.warnings || [],
  }, null, 2));
} finally {
  await pool.end();
}

