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
    anchor: `${kind}-${index + 1}`,
    index: index + 1,
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
    const index = Number(item.note);
    return { href: `#note-${index}`, title: item.title || noteTitle(notes[index - 1]) };
  }
  if (item.decision != null && decisions[Number(item.decision) - 1]) {
    const index = Number(item.decision);
    return {
      href: `#decision-${index}`,
      title: item.title || decisions[index - 1].title,
    };
  }
  if (typeof item.href === "string" && item.href.startsWith("#") && item.title) {
    return { href: item.href, title: item.title };
  }
  return null;
}

export function selectHot(briefing) {
  const notes = withNotes(briefing?.news);
  const decisions = Array.isArray(briefing?.decisions) ? briefing.decisions : [];
  const explicit = explicitList(briefing);
  if (explicit) {
    return explicit
      .map((item) => resolveExplicit(item, notes, decisions))
      .filter(Boolean)
      .slice(0, 5);
  }

  const hard = [];
  const rest = [];
  notes.forEach((note, index) => {
    const entry = { note, index };
    if (note.hard_gate === true) hard.push(entry);
    else if (note.finsec === true || note.detail === true) rest.push(entry);
  });

  const chosen = hard.slice(0, 5);
  for (const entry of rest) {
    if (chosen.length >= 5) break;
    chosen.push(entry);
  }
  if (chosen.length < 3) {
    for (let index = 0; index < notes.length && chosen.length < 3; index += 1) {
      if (!chosen.some((entry) => entry.index === index)) {
        chosen.push({ note: notes[index], index });
      }
    }
  }
  chosen.sort((a, b) => a.index - b.index);
  if (chosen.length) {
    return chosen.map(({ note, index }) => ({
      href: `#note-${index + 1}`,
      title: noteTitle(note),
    }));
  }
  if (!decisions.length) return [];
  return decisions.slice(0, 5).map((card, index) => ({
    href: `#decision-${index + 1}`,
    title: card.title,
  }));
}
