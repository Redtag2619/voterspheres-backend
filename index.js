const express = require("express");
const app = express();

app.use(express.json());

// Home check
app.get("/", (req, res) => {
  res.send("VoterSpheres API is running");
});

// Search endpoint (mock data for now)
app.get("/search", (req, res) => {
  const query = req.query.q || "";

  const results = [
    {
      type: "Election",
      title: "2026 Texas Governor Election"
    },
    {
      type: "Candidate",
      title: "Jane Doe – U.S. Senate"
    },
    {
      type: "Ballot Measure",
      title: "Proposition 1 – Education Funding"
    }
  ].filter(item =>
    item.title.toLowerCase().includes(query.toLowerCase())
  );

  res.json({
    query,
    results
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
