import jwt from "jsonwebtoken";

function normalizeRole(role = "") {
  return String(role || "").trim().toLowerCase();
}

export function requireRoles(...allowedRoles) {
  const normalizedAllowedRoles = allowedRoles.map(normalizeRole);

  return async function roleGuard(req, res, next) {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      if (!token) {
        return res.status(401).json({ error: "Missing bearer token" });
      }

      const secret = process.env.JWT_SECRET || "dev-secret";
      const decoded = jwt.verify(token, secret);

      const userRole = normalizeRole(decoded?.role);

      if (!normalizedAllowedRoles.includes(userRole)) {
        return res.status(403).json({
          error: "Insufficient permissions"
        });
      }

      req.authUser = decoded;
      return next();
    } catch (error) {
      return res.status(401).json({
        error: error.message || "Unauthorized"
      });
    }
  };
}
