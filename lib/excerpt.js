/** Public index blurbs: about 120–160 characters, not a permanent hardcoded string. */
export function excerpt(value, max = 150) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("")}…`;
}
