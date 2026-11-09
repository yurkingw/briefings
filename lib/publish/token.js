const TOKEN_CHARS = /^[A-Za-z0-9._-]+$/;

export function tokenIsUsable(value) {
  return typeof value === "string" && value.length > 0 && TOKEN_CHARS.test(value);
}

export function readPublishToken(env = process.env) {
  const value = env.BRIEFINGS_PUBLISH_TOKEN;
  return tokenIsUsable(value) ? value : "";
}

export function redact(text, token) {
  const source = String(text);
  if (!token) return source;
  return source.split(token).join("[redacted]");
}
