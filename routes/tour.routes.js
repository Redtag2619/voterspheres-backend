import express from "express";

const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tour"
  });
});

router.post("/voice", async (req, res) => {
  try {
    const {
      text,
      voice = "nova",
      model = "gpt-4o-mini-tts"
    } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY missing"
      });
    }

    const response = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          voice,
          input: text
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();

      return res.status(500).json({
        error
      });
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.send(buffer);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

export default router;