/** Public-repo strip rules from the briefings export contract. */

export const DROP_KEYS = new Set([
  "canvas_id",
  "canvasId",
  "store_url",
  "storeUrl",
  "folder_id",
  "folderId",
  "routine_id",
  "routineId",
  "routine_folder_id",
  "workspace",
  "workspace_path",
]);

export const FORBIDDEN_OUTPUT = [
  { name: "canvas_id", re: /canvas_id/i },
  { name: "workspace path", re: /\/workspace\b/ },
  { name: "canvas store url", re: /cursor\.com\/canvas/i },
  { name: "cursor store path", re: /\/cursor\/stores\b/ },
  { name: "folder id", re: /folder[_-]?id/i },
  { name: "routine id", re: /routine[_-]?(?:folder[_-]?)?id/i },
  { name: "home pagination", re: /Home\s*\d+\s*页/ },
  { name: "exact wan impressions", re: /\d+(?:\.\d+)?\s*万\s*曝光/ },
  { name: "exact impressions", re: /\d[\d,]*\s+impressions\b/i },
  { name: "rising-enriched package", re: /rising-enriched/ },
  { name: "intraday package", re: /intraday-[\w.-]+\.(?:tsx|ts|jsx|js)/ },
  { name: "qianji ledger filename", re: /qianji-\d{4}-\d{2}-\d{2}\.md/ },
  { name: "github-rank package", re: /github-rank-[\w.-]+/ },
  { name: "papers-dair package", re: /papers-dair-[\w.-]+/ },
];

const TEXT_REPLACERS = [
  [/canvas_id\s*[:=]\s*["']?[\w-]+["']?/gi, ""],
  [/\bcanvas_id\b/gi, ""],
  [/\/workspace(?:\/[^\s"'<>)]*)?/g, ""],
  [/https?:\/\/[^\s"'<>]*cursor\.com\/canvas[^\s"'<>]*/gi, ""],
  [/https?:\/\/[^\s"'<>]*\/cursor\/stores\/[^\s"'<>]*/gi, ""],
  [/\bfolder[_-]?id\b\s*[:=]\s*["']?[\w-]+["']?/gi, ""],
  [/\broutine[_-]?(?:folder[_-]?)?id\b\s*[:=]\s*["']?[\w-]+["']?/gi, ""],
  [/Home\s*\d+\s*页内未见强簇（([^）]+)）/g, "$1"],
  [/Home\s*\d+\s*页(?:内)?(?:未见强簇)?/g, ""],
  [/(?:约|大约)?\s*\d+(?:\.\d+)?\s*万\s*曝光/g, "（精确曝光已省略）"],
  [/\d[\d,]*\s+impressions\b/gi, "（精确曝光已省略）"],
  [/星数以\s*rising-enriched\s*为准/g, "星数以补全星数为准"],
  [/\brising-enriched\b/g, "补全星数"],
  [/\bintraday-[\w.-]+\.(?:tsx|ts|jsx|js)\b/g, ""],
  [/\bqianji-\d{4}-\d{2}-\d{2}\.md\b/g, ""],
  [/\bgithub-rank-[\w.-]+\b/g, ""],
  [/\bpapers-dair-[\w.-]+\b/g, ""],
];

const MONEY = /(?:\$|€|£)\s?\d|\d+(?:\.\d+)?\s*亿/;
const UNCERTAIN = /unconfirmed|不确认|不确定|数量级/;

export function findForbidden(text) {
  if (!text) return [];
  const hits = [];
  for (const rule of FORBIDDEN_OUTPUT) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) hits.push(rule.name);
  }
  return hits;
}

export function stripText(value) {
  let text = String(value);
  for (const [pattern, replacement] of TEXT_REPLACERS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return text.replace(/（\s*）/g, "");
}

export function annotateUnconfirmed(value) {
  const text = String(value);
  if (!MONEY.test(text) || !UNCERTAIN.test(text) || /unconfirmed/i.test(text)) {
    return text;
  }
  if (text.trimStart().startsWith("|")) {
    const parts = text.split("|");
    if (parts.length > 4) {
      parts[3] = `${parts[3].trimEnd()}（unconfirmed）`;
      return parts.join("|");
    }
  }
  return `${text}（unconfirmed）`;
}

export function sanitizeLink(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const href = parsed.toString();
  if (findForbidden(href).length) return null;
  return href;
}

export function stripValue(value) {
  if (Array.isArray(value)) return value.map((item) => stripValue(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (DROP_KEYS.has(key)) continue;
      if ((key === "url" || key === "dair_url") && typeof inner === "string") {
        const clean = sanitizeLink(stripText(inner));
        if (clean) out[key] = clean;
        continue;
      }
      if (key === "links" && Array.isArray(inner)) {
        out[key] = inner
          .map((link) => {
            if (typeof link === "string") return sanitizeLink(stripText(link));
            if (link && typeof link === "object" && typeof link.url === "string") {
              const url = sanitizeLink(stripText(link.url));
              if (!url) return null;
              const label = typeof link.label === "string" ? stripText(link.label).trim() : "";
              return label ? { label, url } : url;
            }
            return null;
          })
          .filter(Boolean);
        continue;
      }
      out[key] = stripValue(inner);
    }
    return out;
  }
  if (typeof value === "string") return annotateUnconfirmed(stripText(value));
  return value;
}

export function stripMarkdown(markdown) {
  return markdown
    .split("\n")
    .map((line) => annotateUnconfirmed(stripText(line)))
    .join("\n");
}
