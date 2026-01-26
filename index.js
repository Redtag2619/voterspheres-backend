import express from "express";
import cors from "cors";

const app = express();

app.use(cors()); // ⭐ THIS FIXES CORS
app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("VoterSpheres Backend Running");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Example API route
app.get("/api/test", (req, res) => {
  res.json({ message: "API working" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
