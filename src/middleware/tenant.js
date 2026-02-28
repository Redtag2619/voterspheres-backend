export const requireTenant = (req, res, next) => {
  if (!req.user || !req.user.organizationId) {
    return res.status(403).json({
      message: "Tenant context missing"
    });
  }

  // Attach orgId for easy access
  req.organizationId = req.user.organizationId;

  next();
};
