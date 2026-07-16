import express from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  clearExecutiveVoiceSourceCache,
  getCongressUpdates,
  getElectionAdministrationUpdates,
  getExecutiveVoiceSourceHealth,
  getOpenFecFinance,
  getPollingProviderData,
  getWeatherFieldRisk,
  searchCurrentPoliticalNews,
} from "../services/executiveVoiceLiveSources.service.js";

const router =
  express.Router();

const limiter =
  rateLimit({
    windowMs:
      60 * 1000,

    limit:
      Number(
        process.env
          .EXECUTIVE_VOICE_SOURCE_RATE_LIMIT ||
          60
      ),

    standardHeaders:
      true,

    legacyHeaders:
      false,

    message: {
      ok: false,

      error:
        "Executive Voice live-source rate limit exceeded.",
    },
  });

router.get(
  "/health",
  requireAuth,
  async (req, res) => {
    try {
      const output =
        await getExecutiveVoiceSourceHealth();

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] health failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Live-source health could not be loaded.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/news",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const output =
        await searchCurrentPoliticalNews(
          req.body ||
            {}
        );

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] news failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Live political news search failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/fec",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const output =
        await getOpenFecFinance({
          candidateId:
            req.body
              ?.candidate_id,

          committeeId:
            req.body
              ?.committee_id,

          cycle:
            req.body
              ?.cycle,
        });

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] FEC failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "OpenFEC lookup failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/legislation",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const output =
        await getCongressUpdates(
          req.body ||
            {}
        );

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] legislation failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Legislative lookup failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/weather-risk",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const output =
        await getWeatherFieldRisk(
          req.body ||
            {}
        );

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] weather failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Weather field-risk lookup failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/polling",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const output =
        await getPollingProviderData(
          req.body ||
            {}
        );

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] polling failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Polling-provider lookup failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/election-administration",
  requireAuth,
  limiter,
  async (req, res) => {
    try {
      const output =
        await getElectionAdministrationUpdates(
          req.body ||
            {}
        );

      return res.json(
        output
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] election administration failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Election-administration lookup failed.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

router.post(
  "/cache/clear",
  requireAuth,
  async (req, res) => {
    try {
      return res.json(
        clearExecutiveVoiceSourceCache()
      );
    } catch (error) {
      console.error(
        "[executive-voice-live-sources] cache clear failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Live-source cache could not be cleared.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

export default router;
