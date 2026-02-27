import express from "express";
import { register, login } from "../services/auth.service.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const token = await register(req.body.email, req.body.password);
    res.json({ token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const token = await login(req.body.email, req.body.password);
    res.json({ token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
