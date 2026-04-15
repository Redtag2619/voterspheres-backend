import {
  deleteCandidateProfile,
  findCandidateAdminDirectory,
  findCandidateProfileByCandidateId,
  upsertCandidateProfile
} from "../repositories/candidateProfiles.repository.js";
import { findCandidateById } from "../repositories/candidates.repository.js";

export async function getCandidateProfileAdminDirectory(req, res, next) {
  try {
    const { q = "", page = 1, limit = 25 } = req.query;

    const payload = await findCandidateAdminDirectory({
      q: String(q || "").trim(),
      page: Number(page) || 1,
      limit: Number(limit) || 25
    });

    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function getCandidateProfileByCandidateId(req, res, next) {
  try {
    const candidateId = Number(req.params.candidateId);

    if (!candidateId) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const [candidate, profile] = await Promise.all([
      findCandidateById(candidateId),
      findCandidateProfileByCandidateId(candidateId)
    ]);

    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json({
      candidate,
      profile
    });
  } catch (err) {
    next(err);
  }
}

export async function saveCandidateProfile(req, res, next) {
  try {
    const candidateId = Number(req.params.candidateId);

    if (!candidateId) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const candidate = await findCandidateById(candidateId);

    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    const profile = await upsertCandidateProfile(candidateId, req.body || {});

    res.json({
      ok: true,
      candidate,
      profile
    });
  } catch (err) {
    next(err);
  }
}

export async function removeCandidateProfile(req, res, next) {
  try {
    const candidateId = Number(req.params.candidateId);

    if (!candidateId) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const deleted = await deleteCandidateProfile(candidateId);

    res.json({
      ok: true,
      deleted: Boolean(deleted)
    });
  } catch (err) {
    next(err);
  }
}
