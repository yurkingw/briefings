/** Public detail-page groups and Hot this wave selection. */

import { ANGLES, entryCount, labels } from "./ui-labels.js";

export const DOMAIN_GROUPS = [
  { id: "ai-products", label: "AI products & tech" },
  { id: "ai-security", label: "AI security" },
  { id: "other-security", label: "Other security" },
];

const GROUP_IDS = new Set(DOMAIN_GROUPS.map((group) => group.id));

export function withNotes(items) {
  return (items || []).filter(
    (item) =>
      item &&
      (item.background ||
        item.facts ||
        item.why ||
        item.arch_impact ||
        (item.links && item.links.length)),
  );
}

export function noteTitle(item) {
  return `#${item.id} · ${item.domain} · ${item.title}`;
}

/** Render-layer title. Strip a baked `#N ·` prefix, and a repeated domain after it. */
export function displayTitle(item) {
  const raw = String(item?.title || "").trim();
  const match = raw.match(/^#\s*\d+\s*[·•]\s*/);
  if (!match) return raw;
  let rest = raw.slice(match[0].length).trim();
  const domain = String(item?.domain || "").trim();
  if (domain) {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rest = rest.replace(new RegExp(`^${escaped}\\s*[·•]\\s*`), "");
  }
  return rest.trim();
}

function hotEntry(item, href) {
  return {
    href,
    n: item?.id,
    domain: item?.domain || "",
    title: displayTitle(item),
  };
}

function matchDomainToken(token) {
  if (token === "AI产品" || /^AI products/i.test(token)) return "ai-products";
  if (token === "AI安全" || /^AI security/i.test(token)) return "ai-security";
  if (token === "其他安全" || token === "加密" || /^other security/i.test(token)) {
    return "other-security";
  }
  return null;
}

export function domainGroupId(source) {
  const domain = String(source?.domain || "").trim();
  if (domain) {
    const parts = domain.split(/[/、,|]/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const id = matchDomainToken(part);
      if (id) return id;
    }
    return "other-security";
  }
  const text = [source?.title, ...(source?.control_domains || [])].filter(Boolean).join(" ");
  if (/LPE|提权|攻防|漏洞|Security Review|补丁/.test(text)) return "ai-security";
  if (/银行|出金|资金|金库|加密|支付|CERT/.test(text)) return "other-security";
  if (/产品/.test(text)) return "ai-products";
  return "other-security";
}

function entriesFor(items, kind) {
  return (items || []).map((item, index) => ({
    anchor: kind === "decision" ? `decision-${index + 1}` : `note-${item.id}`,
    index: kind === "decision" ? index + 1 : item.id,
    title: kind === "decision" ? item.title : noteTitle(item),
    channel: item.channel || "",
    groupId: GROUP_IDS.has(domainGroupId(item)) ? domainGroupId(item) : "other-security",
  }));
}

export function tocGroups(items, kind = "note") {
  const entries = entriesFor(items, kind === "decision" ? "decision" : "note");
  const buckets = new Map(DOMAIN_GROUPS.map((group) => [group.id, []]));
  for (const entry of entries) buckets.get(entry.groupId).push(entry);
  return DOMAIN_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: buckets.get(group.id),
  })).filter((group) => group.items.length);
}

function explicitList(briefing) {
  if (Array.isArray(briefing?.hot)) return briefing.hot;
  if (Array.isArray(briefing?.hot_picks)) return briefing.hot_picks;
  if (Array.isArray(briefing?.hot_this_wave)) return briefing.hot_this_wave;
  return null;
}

function resolveExplicit(item, notes, decisions) {
  if (!item || typeof item !== "object") return null;
  if (item.note != null && notes[Number(item.note) - 1]) {
    const note = notes[Number(item.note) - 1];
    const anchor = note.id != null ? `note-${note.id}` : `note-${item.note}`;
    const source = item.title ? { ...note, title: item.title } : note;
    return hotEntry(source, `#${anchor}`);
  }
  if (item.decision != null && decisions[Number(item.decision) - 1]) {
    const index = Number(item.decision);
    const card = decisions[index - 1];
    return {
      href: `#decision-${index}`,
      n: index,
      title: displayTitle({ title: item.title || card.title }),
    };
  }
  if (typeof item.href === "string" && item.href.startsWith("#") && item.title) {
    return {
      href: item.href,
      n: item.n ?? null,
      title: displayTitle({ title: item.title, domain: item.domain }),
    };
  }
  return null;
}

export function detailCards(items, cap = 10) {
  return (items || []).filter((item) => item && item.detail === true).slice(0, cap);
}

export function remainderNews(items, cap = 10) {
  const shown = new Set(detailCards(items, cap));
  return (items || []).filter((item) => item && !shown.has(item));
}

export function takeFeatured(items, cap) {
  const list = items || [];
  const marked = list.filter((item) => item && item.detail === true);
  return (marked.length ? marked : list).slice(0, cap);
}

export function takeRest(items, cap) {
  const shown = new Set(takeFeatured(items, cap));
  return (items || []).filter((item) => item && !shown.has(item));
}

export function angleLabel(angle) {
  return ANGLES[angle] || angle || labels.other;
}

export function itemKicker(item) {
  if (item?.angle) return angleLabel(item.angle);
  return item?.domain || "";
}

function clipChars(text, max) {
  const chars = [...String(text || "")];
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("");
}

function hostLabel(href) {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    if (host === "x.com" || host.endsWith(".x.com")) return "X";
    if (host === "github.com") return "GitHub";
    if (host === "arxiv.org") return "arXiv";
    if (host === "nyti.ms" || host.includes("nytimes")) return "NYT";
    return labels.link;
  } catch {
    return labels.link;
  }
}

export function linkView(link) {
  if (!link) return null;
  if (typeof link === "object" && typeof link.href === "string" && link.label) {
    return { href: link.href, label: clipChars(link.label, 12), title: link.title || link.href };
  }
  if (typeof link === "string") {
    return { href: link, label: hostLabel(link), title: link };
  }
  if (typeof link === "object" && typeof link.url === "string") {
    const raw = String(link.label || "").trim();
    return {
      href: link.url,
      label: raw ? clipChars(raw, 12) : hostLabel(link.url),
      title: raw ? `${raw} ${link.url}` : link.url,
    };
  }
  return null;
}

export function linkViews(links) {
  return (links || []).map((link) => linkView(link)).filter(Boolean);
}

export function paperLinkList(paper) {
  const links = [];
  if (paper?.url) links.push({ href: paper.url, label: "arXiv", title: paper.url });
  if (paper?.dair_url) links.push({ href: paper.dair_url, label: "DAIR", title: paper.dair_url });
  return links;
}

function sentences(text) {
  return String(text || "")
    .split(/(?<=。)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function paperFields(paper) {
  const parts = sentences(paper?.what);
  const grabbed = paper?.grab || parts[0] || paper?.what || "—";
  const points = paper?.points || paper?.gist || parts.slice(1, 5).join("") || "—";
  return {
    grabbed,
    points,
    why: paper?.why || "—",
  };
}

export function ghWindowValue(item, kind) {
  const newcomers = kind === "newcomers" || kind === "newcomer";
  const gained = item?.gained != null && item.gained !== ""
    ? item.gained
    : item?.gained_week_approx != null && item.gained_week_approx !== ""
      ? item.gained_week_approx
      : null;
  if (gained != null) return `+${formatCount(gained)}`;
  if (newcomers && item?.age_h != null && item.age_h !== "") return `${item.age_h}h`;
  return "—";
}

export function ghSeenValue(item) {
  if (item?.seen) return item.seen;
  if (item?.age_h != null && item.age_h !== "") return `${item.age_h}h`;
  if (Array.isArray(item?.days_seen) && item.days_seen.length) return item.days_seen.join("、");
  return "—";
}

export function hotFromItems(items) {
  const list = items || [];
  const cards = detailCards(list);
  if (cards.length) {
    return cards.slice(0, 5).map((note) => hotEntry(note, `#note-${note.id}`));
  }
  if (list.some((item) => item && item.detail === true)) return [];
  return list.slice(0, 5).filter(Boolean).map((item) => hotEntry(item, `#feature-${item.id}`));
}

export function selectHot(briefing) {
  const news = Array.isArray(briefing?.news) ? briefing.news : [];
  const cards = detailCards(news);
  const decisions = Array.isArray(briefing?.decisions) ? briefing.decisions : [];
  const explicit = explicitList(briefing);
  if (explicit) {
    const pool = cards.length ? cards : news;
    return explicit
      .map((item) => resolveExplicit(item, pool, decisions))
      .filter(Boolean)
      .slice(0, 5);
  }
  return hotFromItems(news);
}

const WAVE_DISPLAY = new Map([
  ["晨间", "Morning"],
  ["午间", "Afternoon"],
  ["午间+晨报补栏", "Afternoon + Morning supplement"],
]);

/** UI label for a stored wave string. Unknown values stay unchanged. */
export function displayWave(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return WAVE_DISPLAY.get(raw) || raw;
}

export function waveBucket(item) {
  const wave = String(item?.wave || "");
  const morning = /晨|morning/i.test(wave);
  const afternoon = /午|afternoon/i.test(wave);
  if (morning && !afternoon) return "morning";
  if (afternoon && !morning) return "afternoon";
  return "unspecified";
}

export function waveItems(items, bucket) {
  return (items || []).filter((item) => {
    const got = waveBucket(item);
    if (got === bucket) return true;
    return got === "unspecified" && bucket === "afternoon";
  });
}

export function hasWaveSplit(briefing) {
  if (briefing?.wave) return true;
  return (briefing?.news || []).some((item) => item?.wave);
}

export function defaultWave(briefing) {
  const news = briefing?.news || [];
  const morning = waveItems(news, "morning");
  const afternoon = waveItems(news, "afternoon");
  if (morning.length && !afternoon.length) return "morning";
  if (afternoon.length && !morning.length) return "afternoon";
  return "morning";
}

export function statusItems(briefing) {
  const metrics = briefing?.metrics || {};
  const pairs = briefing?.date
    ? [
        ["News", metrics.news],
        ["Finsec", metrics.finsec],
        ["Papers", metrics.papers],
        ["GH rising", metrics.gh_rising],
        ["GH newcomers", metrics.gh_newcomers],
        ["Home-related", metrics.home_related],
      ]
    : [
        ["Featured news", metrics.news_featured],
        ["Papers", metrics.papers_featured ?? metrics.papers],
        ["GitHub", metrics.gh_featured],
        ["Decisions", metrics.decisions],
      ];
  return pairs
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({ label, value }));
}

export function hasField(rows, key) {
  return (rows || []).some((row) => row && row[key] != null && row[key] !== "");
}

export function ownerType(value) {
  if (value === "Organization") return "Org";
  if (value === "User") return "User";
  return value || "";
}

export function linkLabel(value) {
  const raw = String(value || "");
  try {
    const url = new URL(raw);
    const path = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "";
    const text = `${url.host}${path}`;
    return text.length > 56 ? `${text.slice(0, 53)}…` : text;
  } catch {
    return raw;
  }
}

export function githubSummary(meta) {
  if (!meta || typeof meta !== "object") return [];
  const note = [meta.archive_note, meta.note].filter(Boolean).join("；");
  const parts = note.split(/[；;]+/).map((part) => part.trim()).filter(Boolean);
  const archive = [];
  const overlap = [];
  const risk = [];
  if (meta.archive) archive.push(`Archive: ${meta.archive}`);
  if (Array.isArray(meta.sources_missing) && meta.sources_missing.length) {
    archive.push(`Missing sources: ${meta.sources_missing.join(", ")}`);
  }
  if (Array.isArray(meta.sources_ok) && meta.sources_ok.length) {
    archive.push(`Sources: ${meta.sources_ok.join(", ")}`);
  }
  for (const part of parts) {
    if (/∩|重合|overlap/i.test(part)) overlap.push(part);
    else if (/风险|趋势|补录|星数|周精选|精选/.test(part)) risk.push(part);
    else archive.push(part);
  }
  const sections = [];
  if (archive.length) sections.push({ id: "archive", title: "Archive", lines: archive });
  if (overlap.length) sections.push({ id: "overlap", title: "Overlap", lines: overlap });
  if (risk.length) sections.push({ id: "risk", title: "Risk · trend", lines: risk });
  return sections;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const WEEKLY_NEWS_GROUPS = [
  { id: "ai-products", label: labels.products },
  { id: "ai-security", label: labels.aiSecurity },
  { id: "other-security", label: labels.otherSecurity },
];

export function compactStars(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (Math.abs(num) < 1000) return String(Math.round(num));
  const k = num / 1000;
  const rounded = Math.abs(k) >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
  return `${rounded}k`;
}

export function formatCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US");
}

export function rankLabel(rank) {
  const num = Number(rank);
  if (!Number.isFinite(num)) return String(rank ?? "");
  return String(Math.trunc(num)).padStart(2, "0");
}

export function ownerFace(value) {
  if (value === "Organization") return labels.organization;
  if (value === "User") return labels.individual;
  return value || "";
}

export function githubMetaLine(item, kind) {
  const parts = [];
  if (kind !== "newcomers" && item?.gained != null && item.gained !== "") {
    parts.push(`+${formatCount(item.gained)}/day`);
  }
  if (item?.stars != null && item.stars !== "") parts.push(`${compactStars(item.stars)}★`);
  if (kind === "newcomers" && item?.age_h != null && item.age_h !== "") parts.push(`${item.age_h}h`);
  if (item?.seen) parts.push(item.seen);
  return parts.join(" · ") || "—";
}

export function statusParts(item) {
  const face = ownerFace(item?.owner_type);
  const who = [face, item?.owner].filter(Boolean).join(" · ");
  return {
    who: who || "—",
    break: item?.break || "",
    danger: Boolean(item?.break),
  };
}

export function githubMetrics(item, kind) {
  if (kind === "newcomers") {
    return [
      { label: labels.stars, value: item?.stars == null || item.stars === "" ? "—" : formatCount(item.stars) },
      { label: labels.launched, value: item?.age_h == null || item.age_h === "" ? "—" : `${item.age_h}h` },
      { label: labels.seen, value: item?.seen || "—" },
    ];
  }
  return [
    { label: labels.perDay, value: item?.gained == null || item.gained === "" ? "—" : `+${formatCount(item.gained)}` },
    { label: labels.stars, value: item?.stars == null || item.stars === "" ? "—" : formatCount(item.stars) },
    { label: labels.launched, value: item?.seen || "—" },
  ];
}

export function isoWeekRangeLabel(weekId, timezone) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(weekId || ""));
  if (!match) return weekId || "—";
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (date) => date.toISOString().slice(0, 10);
  const zone = timezone || "Asia/Shanghai";
  return `${fmt(monday)} ${WEEKDAY[monday.getUTCDay()]} → ${fmt(sunday)} ${WEEKDAY[sunday.getUTCDay()]} (${zone})`;
}

function githubValue(metrics, github) {
  const rising = metrics?.gh_rising;
  const newcomers = metrics?.gh_newcomers;
  const hasRows = (github?.rising || []).length || (github?.newcomers || []).length;
  if (rising == null && newcomers == null && !hasRows) return labels.noEntries;
  if (rising != null && rising === newcomers) return `Trending and newcomers: ${rising} each`;
  return `Trending ${rising ?? "—"} · Newcomers ${newcomers ?? "—"}`;
}

export function dailyPropertyRows(briefing) {
  const metrics = briefing?.metrics || {};
  const news = Array.isArray(briefing?.news) ? briefing.news : [];
  return [
    { label: labels.date, value: briefing?.date || "—" },
    { label: labels.updated, value: displayWave(briefing?.wave) || briefing?.updated_at || "—" },
    { label: labels.news, value: metrics.news ?? news.length },
    ...(metrics.polfin != null ? [{ label: labels.polfin, value: metrics.polfin }] : []),
    { label: labels.dayTotal, value: news.length },
    { label: "finsec", value: metrics.finsec ?? "—" },
    { label: labels.papers, value: metrics.papers ?? (briefing?.papers || []).length },
    { label: labels.homeRelated, value: metrics.home_related ?? "—" },
    { label: "GitHub", value: githubValue(metrics, briefing?.github) },
  ];
}

export function newsGroups(items) {
  return WEEKLY_NEWS_GROUPS.map((group) => ({
    ...group,
    items: (items || []).filter((item) => domainGroupId(item) === group.id),
  })).filter((group) => group.items.length);
}

export function weeklyPropertyRows(briefing) {
  const news = Array.isArray(briefing?.news) ? briefing.news : [];
  const counts = { "ai-products": 0, "ai-security": 0, "other-security": 0 };
  for (const item of news) {
    const id = domainGroupId(item);
    if (counts[id] != null) counts[id] += 1;
  }
  const total = briefing?.metrics?.news_featured ?? news.length;
  const sample = briefing?.sample ? " (sample)" : "";
  return [
    { label: labels.window, value: isoWeekRangeLabel(briefing?.week, briefing?.timezone) },
    { label: labels.thisWeek, value: `${total}${sample}` },
    ...(briefing?.metrics?.polfin != null ? [{ label: labels.polfin, value: briefing.metrics.polfin }] : []),
    { label: labels.products, value: String(counts["ai-products"]) },
    { label: labels.aiSecurity, value: String(counts["ai-security"]) },
    { label: labels.otherSecurity, value: String(counts["other-security"]) },
    { label: labels.shell, value: labels.shellValue },
  ];
}

export function pagePropertyRows(briefing) {
  return briefing?.date ? dailyPropertyRows(briefing) : weeklyPropertyRows(briefing);
}

export function papersWindow(briefing) {
  const papers = briefing?.papers || [];
  if (!papers.length) return "";
  const dair = papers.some((paper) => paper?.dair_url || /dair_ai/i.test(`${paper?.why || ""} ${paper?.what || ""}`));
  const bits = [papers.length === 1 ? "1 paper" : `${papers.length} papers`];
  if (dair) bits.push("@dair_ai");
  if (briefing?.date) bits.push(briefing.date);
  else if (briefing?.week) bits.push(briefing.week);
  return bits.join(" · ");
}

export function boardInsight(rows, meta, kind) {
  const list = rows || [];
  if (!list.length) return "";
  const ranked = [...list].sort((a, b) => (Number(b?.gained) || 0) - (Number(a?.gained) || 0));
  const top = ranked[0];
  const firsts = list.filter((item) => item?.seen === "首见");
  const breaks = list.filter((item) => item?.break).slice(0, 3);
  const bits = [`${kind === "newcomers" ? labels.newcomers : labels.trending}: ${entryCount(list.length)}`];
  if (top?.repo && top.gained != null && top.gained !== "") bits.push(`${top.repo} +${formatCount(top.gained)}`);
  if (firsts.length) bits.push(`First seen: ${firsts.map((item) => item.repo).filter(Boolean).join(", ")}`);
  if (breaks.length) bits.push(breaks.map((item) => `${item.repo} ${item.break}`).join("; "));
  const note = [meta?.archive_note, meta?.note].filter(Boolean).join("；");
  if (note) bits.push(note);
  return bits.join(". ").replace(/\.\s+\./g, ". ");
}

export function summaryView(meta) {
  if (!meta || typeof meta !== "object") return { lines: [], calib: "" };
  const note = [meta.archive_note, meta.note].filter(Boolean).join("；");
  const clauses = note.split(/[；;]+/).map((part) => part.trim()).filter(Boolean);
  const lines = [...clauses];
  if (meta.archive === "missing") lines.push("Archive missing");
  else if (meta.archive && !clauses.some((part) => part.includes(String(meta.archive)))) {
    lines.push(`Archive: ${meta.archive}`);
  }
  if (Array.isArray(meta.sources_missing) && meta.sources_missing.length) {
    lines.push(`Missing sources: ${meta.sources_missing.join(", ")}`);
  }
  if (Array.isArray(meta.sources_ok) && meta.sources_ok.length) {
    lines.push(`Sources: ${meta.sources_ok.join(", ")}`);
  }
  const calib = clauses.find((part) => /口径|星数以|为准/.test(part)) || clauses[clauses.length - 1] || "";
  return { lines, calib };
}

export function saSteps(decisions) {
  const steps = [];
  for (const level of ["P0", "P1", "P2"]) {
    const key = `actions_${level.toLowerCase()}`;
    for (const card of decisions || []) {
      for (const action of card?.[key] || []) {
        steps.push({ level, title: action, detail: card?.title || "" });
      }
    }
  }
  return steps;
}

export function finalJudgments(decisions) {
  const lines = [];
  for (const card of decisions || []) {
    for (const line of card?.judgment || []) lines.push(line);
  }
  return lines;
}

export function financeLead(briefing) {
  const decisions = briefing?.decisions || [];
  if (!decisions.length) return "";
  const hard = (briefing?.news || []).filter((item) => item?.hard_gate === true || item?.finsec === true).length;
  const titles = decisions.map((card, index) => `${index + 1}. ${card.title}`).join("；");
  const gate = hard ? `; News hard gate / finsec: ${hard}` : "";
  return `${entryCount(decisions.length)}${gate}. ${titles}`;
}
