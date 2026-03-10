export function errorHandler(err, _req, res, _next) {
  console.error("API ERROR:", err);

  res.status(err.status || 500).json({
    error: err.message || "Internal server error"
  });
}
