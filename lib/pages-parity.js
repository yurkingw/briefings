/** Public detail-page TOC groups and Hot this wave selection. */

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

export function detailCards(items) {
  return (items || []).filter((item) => item && item.detail === true).slice(0, 8);
}

export function remainderNews(items) {
  return (items || []).filter((item) => item && item.detail !== true);
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
