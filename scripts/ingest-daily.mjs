import fs from "node:fs";
import path from "node:path";
import { findForbidden, sanitizeLink, stripValue } from "../lib/strip-public.js";

const root = path.resolve(import.meta.dirname, "..");
const SOFT_AMOUNT = /量级|叙事|回顾称|昨报|不确认|不确定|数量级|unconfirmed/i;
const MONEY = /(?:\$|€|£)\s?\d|\d+(?:\.\d+)?\s*亿/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeLinks(links, notes) {
  if (links == null) return links;
  if (!Array.isArray(links)) fail("links must be an array when present");
  const out = [];
  for (const link of links) {
    if (typeof link === "string") {
      out.push(link);
      continue;
    }
    if (link && typeof link === "object" && typeof link.url === "string") {
      if (link.label) notes.linkLabels += 1;
      out.push(link.label ? { label: link.label, url: link.url } : link.url);
      continue;
    }
    notes.droppedLinks += 1;
  }
  return out;
}

function markSoftAmount(value, notes) {
  if (typeof value !== "string") return value;
  if (!MONEY.test(value) || !SOFT_AMOUNT.test(value) || /unconfirmed/i.test(value)) return value;
  notes.markedAmounts += 1;
  return `${value}（unconfirmed）`;
}

function walkStrings(value, notes, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => walkStrings(item, notes, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return value;
    seen.add(value);
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = walkStrings(inner, notes, seen);
    return out;
  }
  return markSoftAmount(value, notes);
}

function cell(value) {
  if (value == null || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function yn(value) {
  return value ? "是" : "否";
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function renderMarkdown(data, notes) {
  const news = data.news || [];
  const detail = news.filter((item) => item.detail === true);
  const lines = [];
  lines.push("---");
  lines.push(`title: ${yamlString(`今日情报 · ${data.date}`)}`);
  lines.push(`date: ${data.date}`);
  lines.push(`schema: ${data.schema}`);
  lines.push(`timezone: ${data.timezone}`);
  lines.push(`updated_at: ${yamlString(data.updated_at)}`);
  lines.push(`wave: ${yamlString(data.wave)}`);
  lines.push(`summary: ${yamlString(data.summary)}`);
  lines.push("metrics:");
  for (const [key, value] of Object.entries(data.metrics || {})) {
    lines.push(`  ${key}: ${typeof value === "string" ? yamlString(value) : value}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# 今日情报 · ${data.date}`);
  lines.push("");
  lines.push(`> ${data.summary}`);
  lines.push("");
  lines.push("## 今日主线");
  lines.push("");
  lines.push(data.summary);
  lines.push("");
  lines.push("源 JSON 无独立主线字段，本段沿用 summary，未另写主线。");
  lines.push("");
  lines.push("## 政治金融");
  lines.push("");
  lines.push("| # | 角 | 标题 | 波次 | 详卡 |");
  lines.push("|---|----|------|------|------|");
  for (const item of data.polfin || []) {
    lines.push(`| ${cell(item.id)} | ${cell(item.angle)} | ${cell(item.title)} | ${cell(item.wave)} | ${yn(item.detail)} |`);
  }
  if (!(data.polfin || []).length) lines.push("| — | — | 今日无新（政治金融） | — | — |");
  lines.push("");
  lines.push("## 要闻");
  lines.push("");
  lines.push("| # | 领域 | 标题 | 通路 | finsec | 硬门槛 | 详卡 |");
  lines.push("|---|------|------|------|--------|--------|------|");
  for (const item of news) {
    lines.push(
      `| ${cell(item.id)} | ${cell(item.domain)} | ${cell(item.title)} | ${cell(item.channel)} | ${yn(item.finsec)} | ${yn(item.hard_gate)} | ${yn(item.detail)} |`,
    );
  }
  lines.push("");
  if (detail.length) {
    lines.push(`### 详卡摘要（${detail.map((item) => `#${item.id}`).join(" / ")}）`);
    lines.push("");
    for (const item of detail) {
      lines.push(`#### #${item.id} · ${item.domain} · ${item.title}`);
      lines.push("");
      if (item.background) lines.push(`- **背景**：${item.background}`);
      if (item.facts) lines.push(`- **事实**：${item.facts}`);
      if (item.why) lines.push(`- **为何重要**：${item.why}`);
      if (item.arch_impact) lines.push(`- **架构冲击**：${item.arch_impact}`);
      if (item.channel) lines.push(`- **通路**：${item.channel}`);
      if (item.first_source_at) lines.push(`- **最早来源·时间**：${item.first_source_at}`);
      if (item.links?.length) {
        lines.push(`- **链接**：${item.links.map((link) => (typeof link === "string" ? link : link.url)).join(" · ")}`);
      }
      lines.push("");
    }
  }
  lines.push("## 顶尖论文");
  lines.push("");
  lines.push("| 短名 | 抢了什么 | 为何值得看 | 链接 |");
  lines.push("|------|----------|------------|------|");
  for (const paper of data.papers || []) {
    lines.push(`| ${cell(paper.short)} | ${cell(paper.what)} | ${cell(paper.why)} | ${cell(paper.url)} |`);
  }
  lines.push("");
  lines.push("## GitHub 涨星榜");
  lines.push("");
  lines.push("| # | repo | slogan | +星/天 | 总星 | 见 | 破星 | 语言 |");
  lines.push("|---|------|--------|--------|------|----|------|------|");
  for (const item of data.github?.rising || []) {
    lines.push(
      `| ${cell(item.rank)} | ${cell(`${item.owner}/${item.repo}`)} | ${cell(item.slogan)} | ${cell(item.gained)} | ${cell(item.stars)} | ${cell(item.seen)} | ${cell(item.break)} | ${cell(item.lang)} |`,
    );
  }
  lines.push("");
  lines.push("## GitHub 新锐榜");
  lines.push("");
  lines.push("| # | repo | slogan | 星 | age_h | 见 | 破星 | 语言 |");
  lines.push("|---|------|--------|----|-------|----|------|------|");
  for (const item of data.github?.newcomers || []) {
    lines.push(
      `| ${cell(item.rank)} | ${cell(`${item.owner}/${item.repo}`)} | ${cell(item.slogan)} | ${cell(item.stars)} | ${cell(item.age_h)} | ${cell(item.seen)} | ${cell(item.break)} | ${cell(item.lang)} |`,
    );
  }
  lines.push("");
  lines.push("## GitHub meta");
  lines.push("");
  lines.push(`- Archive：**${data.github?.meta?.archive ?? "—"}**`);
  if (data.github?.meta?.archive_note) lines.push(`- ${data.github.meta.archive_note}`);
  lines.push("");
  lines.push("## sources");
  lines.push("");
  for (const source of data.sources || []) lines.push(`- ${source}`);
  lines.push("");
  lines.push("## 降级说明");
  lines.push("");
  lines.push("缺字段按 2026-11-05 的现有渲染留空或显示为「—」，未补造条目：");
  lines.push("");
  for (const note of notes.lines) lines.push(`- ${note}`);
  lines.push("");
  lines.push("> ingest 以同名 JSON 为准。页面只渲染 JSON。");
  lines.push("");
  return `${lines.join("\n")}`;
}

function collectNotes(data, notes) {
  const lines = [];
  const waves = [...new Set((data.news || []).map((item) => item.wave).filter(Boolean))];
  lines.push("源 JSON 无独立主线字段，今日主线沿用 summary。");
  if (waves.length === 1) {
    lines.push(`要闻波次只有「${waves[0]}」。页面仍会画出午间栏，该栏无条目。`);
  }
  const rising = data.github?.rising || [];
  const newcomers = data.github?.newcomers || [];
  const risingAge = rising.filter((item) => item.age_h == null || item.age_h === "").length;
  if (risingAge) lines.push(`涨星榜 ${risingAge}/${rising.length} 条没有 age_h。`);
  const newGained = newcomers.filter((item) => item.gained == null || item.gained === "").length;
  if (newGained) lines.push(`新锐榜 ${newGained}/${newcomers.length} 条没有 gained。`);
  const blankMeta = [...rising, ...newcomers].filter((item) => !item.lang || !item.license).length;
  if (blankMeta) lines.push(`${blankMeta} 条仓库的 lang 或 license 为空，未补。`);
  const truncated = [...rising, ...newcomers].filter((item) => /…|\.\.\./.test(`${item.slogan || ""}${item.what || ""}`)).length;
  if (truncated) lines.push(`${truncated} 条 slogan 或 what 在源中已截断，未补全。`);
  const noArch = (data.news || []).filter((item) => item.detail === true && !item.arch_impact).length;
  if (noArch) lines.push(`${noArch} 张详卡没有架构冲击，页内不单列该行。`);
  if (notes.linkLabels) lines.push(`保留 ${notes.linkLabels} 条带标签链接，表内只显示短标。`);
  if (notes.droppedLinks) lines.push(`丢弃 ${notes.droppedLinks} 条没有可用 URL 的链接。`);
  if (notes.markedAmounts) lines.push(`${notes.markedAmounts} 处源文字自带量级、叙事或回顾称的金额已标 unconfirmed。`);
  if (data.github?.meta?.sources_missing?.length) {
    lines.push(`GitHub 缺源：${data.github.meta.sources_missing.join("、")}。`);
  }
  notes.lines = lines;
}

const sourcePath = process.argv[2];
if (!sourcePath) fail("usage: node scripts/ingest-daily.mjs <daily.json>");

const raw = fs.readFileSync(sourcePath, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  fail(`invalid JSON (${error.message})`);
}
if (data.schema !== "qianji.briefing.daily.v1") fail(`schema must be qianji.briefing.daily.v1, got ${data.schema}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) fail("date must be YYYY-MM-DD");

const notes = { linkLabels: 0, droppedLinks: 0, markedAmounts: 0, lines: [] };
for (const key of ["news", "polfin"]) {
  if (Array.isArray(data[key])) {
    data[key] = data[key].map((item) => ({ ...item, links: normalizeLinks(item.links, notes) }));
  }
}
data = walkStrings(data, notes);
data = stripValue(data);

const serialized = `${JSON.stringify(data, null, 2)}\n`;
const forbidden = findForbidden(serialized);
if (forbidden.length) fail(`refusing to write forbidden public text: ${forbidden.join(", ")}`);

collectNotes(data, notes);
const dailyDir = path.join(root, "content", "daily");
fs.mkdirSync(dailyDir, { recursive: true });
const stem = path.join(dailyDir, data.date);
fs.writeFileSync(`${stem}.json`, serialized);
fs.writeFileSync(`${stem}.md`, renderMarkdown(data, notes));

console.log(`wrote content/daily/${data.date}.json`);
console.log(`wrote content/daily/${data.date}.md`);
for (const line of notes.lines) console.log(`- ${line}`);
