import jwt from "jsonwebtoken";

export async function requireFirmAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const secret = process.env.JWT_SECRET || "dev-secret";
    const decoded = jwt.verify(token, secret);

    if (!decoded?.id) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (String(decoded.role || "").toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.authUser = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: error.message || "Unauthorized"
    });
  }
}
