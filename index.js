const express = require("express");
const cors = require("cors");

const app = express();

/**
 * ✅ Explicit CORS configuration
 */
app.use(
  cors({
    origin: "https://voterspheres.org",
    methods: ["GET"],
    allowedHeaders: ["Content-Type"],
  })
);

/**
 * ✅ Explicit cache control for browser safety
 */
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json());

// Root health check
app.get("/", (req, res) => {
  res.send("VoterSpheres API is running");
});

// Search endpoint
app.get("/search", (req, res) => {
  const query = (req.query.q || "").toLowerCase();

  const data = [
    { type: "Election", title: "2026 Texas Governor Election" },
    { type: "Election", title: "2026 California Senate Election" },
    { type: "Candidate", title: "Jane Doe – U.S. Senate" },
    { type: "Ballot Measure", title: "Proposition 1 – Education Funding" }
  ];

  const results = data.filter(item =>
    item.title.toLowerCase().includes(query)
  );

  res.json({
    query,
    results
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`VoterSpheres backend running on port ${PORT}`);
});
