const TOKEN_CHARS = /^[A-Za-z0-9._-]+$/;
const TOKEN_NAME = "BRIEFINGS_PUBLISH_TOKEN";

export function tokenIsUsable(value) {
  return typeof value === "string" && value.length > 0 && TOKEN_CHARS.test(value);
}

export function readPublishToken(env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(env, TOKEN_NAME)) return "";
  const value = env[TOKEN_NAME];
  return tokenIsUsable(value) ? value : "";
}

// Presence and validation category only. Never attach the value, its length, or a hash.
export function classifyPublishToken(env = process.env) {
  if (env == null || typeof env !== "object") {
    return Object.freeze({ present: false, category: "absent" });
  }
  const present = Object.prototype.hasOwnProperty.call(env, TOKEN_NAME);
  if (!present) return Object.freeze({ present: false, category: "absent" });
  const value = env[TOKEN_NAME];
  if (typeof value !== "string") return Object.freeze({ present: true, category: "invalid_type" });
  if (value.length === 0) return Object.freeze({ present: true, category: "empty" });
  if (!TOKEN_CHARS.test(value)) return Object.freeze({ present: true, category: "invalid_charset" });
  return Object.freeze({ present: true, category: "usable" });
}

export function redact(text, token) {
  const source = String(text);
  if (!token) return source;
  return source.split(token).join("[redacted]");
}
