import dotenv from "dotenv";
import {
  ensureFecTables,
  upsertFecCandidate,
  insertFundraisingSnapshot
} from "../repositories/fecIngestion.repository.js";
import {
  fetchCandidateSearch,
  fetchCandidateTotals
} from "../providers/fec.provider.js";

dotenv.config();

export async function runFecCandidateIngestion({
  cycle = Number(process.env.FEC_CYCLE || 2026),
  limit = Number(process.env.FEC_INGEST_LIMIT || 5),
  office = "",
  state = "",
  q = ""
} = {}) {
  await ensureFecTables();

  const candidates = await fetchCandidateSearch({
    cycle,
    perPage: limit,
    office,
    state,
    q
  });

  const storedCandidates = [];
  const snapshots = [];

  for (const candidate of candidates) {
    const savedCandidate = await upsertFecCandidate(candidate);
    storedCandidates.push(savedCandidate);

    const totals = await fetchCandidateTotals(candidate.candidate_id, cycle).catch(
      () => null
    );

    if (totals) {
      const snapshot = await insertFundraisingSnapshot({
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.name,
        state: candidate.state,
        office: candidate.office_full || candidate.office,
        party: candidate.party_full || candidate.party,
        cycle,
        receipts: totals.receipts,
        disbursements: totals.disbursements,
        cash_on_hand: totals.cash_on_hand_end_period,
        debt: totals.debts_owed_by_committee,
        coverage_start_date: totals.coverage_start_date,
        coverage_end_date: totals.coverage_end_date
      });

      snapshots.push(snapshot);
    }
  }

  return {
    ok: true,
    cycle,
    fetched: candidates.length,
    candidates_upserted: storedCandidates.length,
    fundraising_snapshots_inserted: snapshots.length
  };
}
