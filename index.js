const express = require("express");
const app = express();

app.use(express.json());

// Root check
app.get("/", (req, res) => {
  res.send("VoterSpheres API is running");
});

// 🔍 SEARCH ROUTE (THIS WAS MISSING)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VoterSpheres backend running on port ${PORT}`);
});
