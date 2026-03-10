export function sendContract(res, schema, payload, status = 200) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    return res.status(500).json({
      error: "Response contract validation failed",
      issues: parsed.error.issues
    });
  }

  return res.status(status).json(parsed.data);
}

export function parseContract(schema, payload) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    const error = new Error("Request contract validation failed");
    error.status = 400;
    error.issues = parsed.error.issues;
    throw error;
  }

  return parsed.data;
}
