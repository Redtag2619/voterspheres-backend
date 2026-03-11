import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const FEC_API_BASE_URL =
  process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1";
const FEC_API_KEY = process.env.FEC_API_KEY || "";

function requireApiKey() {
  if (!FEC_API_KEY) {
    throw new Error("FEC_API_KEY is missing");
  }
}

async function fecGet(path, params = {}) {
  requireApiKey();

  const response = await axios.get(`${FEC_API_BASE_URL}${path}`, {
    params: {
      api_key: FEC_API_KEY,
      ...params
    },
    timeout: 30000
  });

  return response.data;
}

export async function fetchCandidateSearch({
  q = "",
  cycle = 2026,
  office = "",
  state = "",
  page = 1,
  perPage = 20
} = {}) {
  const data = await fecGet("/candidates/search/", {
    q: q || undefined,
    cycle,
    office: office || undefined,
    state: state || undefined,
    page,
    per_page: perPage,
    sort_hide_null: false
  });

  return data?.results || [];
}

export async function fetchCandidateByFecId(candidateId) {
  const data = await fecGet("/candidates/search/", {
    candidate_id: candidateId
  });

  return data?.results?.[0] || null;
}

export async function fetchCandidateTotals(candidateId, cycle = 2026) {
  const data = await fecGet(`/candidate/${candidateId}/totals/`, {
    cycle,
    sort_null_only: false
  });

  return data?.results?.[0] || null;
}

export async function fetchCommitteeTotals(committeeId, cycle = 2026) {
  const data = await fecGet(`/committee/${committeeId}/totals/`, {
    cycle,
    sort_null_only: false
  });

  return data?.results?.[0] || null;
}

export async function fetchLatestCandidateFilings(candidateId, page = 1, perPage = 20) {
  const data = await fecGet("/schedules/schedule_a/", {
    candidate_id: candidateId,
    page,
    per_page: perPage,
    sort: "-contribution_receipt_date"
  });

  return data?.results || [];
}

export async function fetchLiveFundraisingSnapshot({
  cycle = 2026,
  q = "",
  office = "",
  state = "",
  limit = 20
} = {}) {
  const candidates = await fetchCandidateSearch({
    q,
    cycle,
    office,
    state,
    perPage: limit
  });

  const enriched = await Promise.all(
    candidates.map(async (candidate) => {
      const totals = await fetchCandidateTotals(candidate.candidate_id, cycle).catch(
        () => null
      );

      return {
        candidate_id: candidate.candidate_id,
        name: candidate.name,
        party: candidate.party_full || candidate.party || null,
        office: candidate.office_full || candidate.office || null,
        state: candidate.state || null,
        incumbent_challenge_full: candidate.incumbent_challenge_full || null,
        principal_committees: candidate.principal_committees || [],
        totals: totals
          ? {
              receipts: Number(totals.receipts || 0),
              disbursements: Number(totals.disbursements || 0),
              cash_on_hand_end_period: Number(
                totals.cash_on_hand_end_period || 0
              ),
              debts_owed_by_committee: Number(
                totals.debts_owed_by_committee || 0
              ),
              last_cash_on_hand_end_period: Number(
                totals.last_cash_on_hand_end_period || 0
              ),
              cycle: totals.cycle || cycle,
              coverage_start_date: totals.coverage_start_date || null,
              coverage_end_date: totals.coverage_end_date || null
            }
          : null
      };
    })
  );

  return enriched.sort(
    (a, b) =>
      Number(b?.totals?.receipts || 0) - Number(a?.totals?.receipts || 0)
  );
}
