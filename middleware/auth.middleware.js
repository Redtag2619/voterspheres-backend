import jwt from "jsonwebtoken";
import pool from "../config/database.js";

function extractToken(req) {
  const authHeader = req.headers.authorization || "";

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const queryToken = req.query?.token ? String(req.query.token).trim() : "";
  if (queryToken) return queryToken;

  return "";
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const secret = process.env.JWT_SECRET || "dev-secret";
    const payload = jwt.verify(token, secret);

    const userId =
      payload?.id ||
      payload?.userId ||
      payload?.user_id ||
      payload?.sub ||
      null;

    const firmIdFromToken = payload?.firm_id || payload?.firmId || null;

    if (!userId) {
      return res.status(401).json({
        error:
