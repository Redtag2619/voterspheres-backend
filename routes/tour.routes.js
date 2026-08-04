import express from "express";

const router = express.Router();

const DEFAULT_MODEL =
  process.env.OPENAI_TOUR_VOICE_MODEL ||
  "gpt-4o-mini-tts";

const DEFAULT_VOICE =
  process.env.OPENAI_TOUR_VOICE ||
  "marin";

const ALLOWED_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

const DEFAULT_INSTRUCTIONS = [
  "Speak like a warm, polished human product specialist.",
  "Use a natural conversational American delivery.",
  "Speak calmly and confidently.",
  "Use brief pauses between ideas and sentences.",
  "Apply subtle emphasis to important business outcomes.",
  "Avoid robotic cadence, announcer-style delivery, exaggerated enthusiasm, and rushed speech.",
  "Pronounce VoterSpheres as Voter Spheres.",
].join(" ");

function cleanText(value, maxLength = 5000) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeVoice(value) {
  const requested = cleanText(value, 30).toLowerCase();

  return ALLOWED_VOICES.has(requested)
    ? requested
    : DEFAULT_VOICE;
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tour",
    voice_model: DEFAULT_MODEL,
    default_voice: DEFAULT_VOICE,
    natural_voice: true,
  });
});

router.post("/voice", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "OPENAI_API_KEY missing",
      });
    }

    const text = cleanText(req.body?.text, 5000);

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "Tour narration text is required.",
      });
    }

    const model =
      cleanText(req.body?.model, 80) ||
      DEFAULT_MODEL;

    const voice = normalizeVoice(
      req.body?.voice || DEFAULT_VOICE
    );

    /*
     * Support both names so the current frontend remains compatible.
     * The OpenAI Speech API receives this as `instructions`.
     */
    const requestedInstructions = cleanText(
      req.body?.instructions ||
        req.body?.style,
      2000
    );

    const instructions =
      requestedInstructions ||
      DEFAULT_INSTRUCTIONS;

    const response = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.OPENAI_API_KEY}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          model,
          voice,
          input: text,
          instructions,
          response_format: "mp3",
        }),
      }
    );

    if (!response.ok) {
      const detail = await response
        .text()
        .catch(() => "");

      console.error(
        "[tour-voice] OpenAI speech request failed:",
        {
          status: response.status,
          model,
          voice,
          detail,
        }
      );

      return res.status(502).json({
        ok: false,
        error: "Tour voice generation failed.",
        detail:
          process.env.NODE_ENV === "production"
            ? undefined
            : detail,
      });
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Content-Length",
      String(buffer.length)
    );

    res.setHeader(
      "Cache-Control",
      "private, max-age=300"
    );

    res.setHeader(
      "X-Tour-Voice",
      voice
    );

    res.setHeader(
      "X-Tour-Voice-Model",
      model
    );

    return res.status(200).send(buffer);
  } catch (error) {
    console.error(
      "[tour-voice] Unexpected failure:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Tour voice could not be generated.",

      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : error?.message,
    });
  }
});

export default router;