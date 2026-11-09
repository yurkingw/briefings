const ALLOWED = ["result", "exit", "schema", "period", "updated_at", "content_hash", "attempts", "reason"];

export function machineResult(fields) {
  const out = {};
  for (const key of ALLOWED) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}
