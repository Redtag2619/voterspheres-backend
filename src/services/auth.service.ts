import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { users, User } from "../db.js";
import crypto from "crypto";

export async function register(email: string, password: string) {
  const existing = users.find(u => u.email === email);
  if (existing) throw new Error("User already exists");

  const passwordHash = await bcrypt.hash(password, 10);

  const newUser: User = {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    role: "user",
    subscriptionStatus: "inactive",
    tenantId: crypto.randomUUID()
  };

  users.push(newUser);

  return generateToken(newUser);
}

export async function login(email: string, password: string) {
  const user = users.find(u => u.email === email);
  if (!user) throw new Error("Invalid credentials");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error("Invalid credentials");

  return generateToken(user);
}

function generateToken(user: User) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      subscriptionStatus: user.subscriptionStatus,
      tenantId: user.tenantId
    },
    config.jwtSecret,
    { expiresIn: "1d" }
  );
}
