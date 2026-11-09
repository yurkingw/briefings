/** Display labels for generated UI. Report fields are not translated here. */

export const labels = {
  news: "News",
  polfin: "Politics & Finance",
  papers: "Papers",
  appendix: "Appendix",
  morning: "Morning",
  afternoon: "Afternoon",
  trending: "Trending",
  newcomers: "Newcomers",
  summary: "Summary",
  financialDecisions: "Financial Decisions",
  thisWeek: "This week",
  today: "Today",
  read: "Read",
  top: "Top",
  backToTop: "Back to top",
  theme: "Theme",
  noEntries: "No entries yet.",
  updated: "Updated",
  source: "Source",
  sources: "Sources",
  sections: "Sections",
  wave: "Wave",
  hotThisWave: "Hot this wave",
  otherPoints: "Other points",
  otherPapers: "Other papers",
  otherRepos: "Other repositories",
  dayTotal: "Day total",
  dailyBriefing: "Daily briefing",
  weeklyBriefing: "Weekly briefing",
  status: "Status",
  hardGate: "Hard gate",
  basis: "Basis",
  saActions: "SA actions",
  finalJudgment: "Final judgment",
  background: "Background",
  facts: "Facts",
  whyItMatters: "Why it matters",
  architectureImpact: "Architecture impact",
  channel: "Channel",
  firstSeen: "First seen",
  links: "Links",
  domain: "Domain",
  title: "Title",
  angle: "Angle",
  section: "Section",
  shortName: "Short",
  what: "What",
  points: "Points",
  whyRead: "Why read",
  judgment: "Judgment",
  controlDomains: "Control domains",
  costTradeoff: "Cost tradeoff",
  whyItRose: "Why it rose",
  windowDelta: "+N/window",
  stars: "Stars",
  launched: "Launched",
  seen: "Seen",
  perDay: "+/day",
  date: "Date",
  homeRelated: "Home-related",
  window: "Window",
  shell: "Shell",
  shellValue: "Five columns · no TOC",
  link: "Link",
  organization: "Organization",
  individual: "Individual",
  other: "Other",
  products: "AI products & tech",
  aiSecurity: "AI security",
  otherSecurity: "Other security",
};

export const ANGLES = {
  sanctions: "Sanctions",
  regulation: "Regulation",
  election: "Election",
  industrial_policy: "Industrial policy",
  geo_finance: "Geofinance",
  other: "Other",
};

export function entryCount(count) {
  const n = Math.max(0, Number(count) || 0);
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

export function showMoreLabel(remaining) {
  return `Show more (${remaining})`;
}

export function textLang(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? "")) ? "zh-Hans" : "";
}
