import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  user?: any;
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header) return res.status(401).json({ error: "Unauthorized" });

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireActiveSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.user.subscriptionStatus !== "active") {
    return res.status(403).json({ error: "Subscription required" });
  }
  next();
}
