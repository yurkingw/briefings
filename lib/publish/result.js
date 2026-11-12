const ALLOWED = ["result", "exit", "schema", "period", "updated_at", "content_hash", "attempts", "reason"];
const TOKEN_CATEGORIES = new Set(["absent", "empty", "invalid_type", "invalid_charset"]);

export function machineResult(fields) {
  const out = {};
  for (const key of ALLOWED) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  if (fields.config_phase === "pre_http") out.config_phase = "pre_http";
  if (fields.token_present === true || fields.token_present === false) out.token_present = fields.token_present;
  if (TOKEN_CATEGORIES.has(fields.token_category)) out.token_category = fields.token_category;
  return out;
}
