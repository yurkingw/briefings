import fs from "node:fs";
import path from "node:path";
import {
  detailCards,
  displayTitle,
  hasWaveSplit,
  hotFromItems,
  paperFields,
  remainderNews,
  saSteps,
  takeFeatured,
  takeRest,
  waveItems,
} from "../lib/pages-parity.js";

const ROUTES = [
  {
    route: "/daily/2026-11-05/",
    content: "content/daily/2026-11-05.json",
    html: "_site/daily/2026-11-05/index.html",
    period: "daily",
  },
  {
    route: "/daily/2026-11-06/",
    content: "content/daily/2026-11-06.json",
    html: "_site/daily/2026-11-06/index.html",
    period: "daily",
  },
  {
    route: "/daily/2026-11-09/",
    content: "content/daily/2026-11-09.json",
    html: "_site/daily/2026-11-09/index.html",
    period: "daily",
  },
  {
    route: "/weekly/2026-W45/",
    content: "content/weekly/2026-W45.json",
    html: "_site/weekly/2026-W45/index.html",
    period: "weekly",
  },
];

export function norm(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function sliceFrom(html, id, stops) {
  const marker = `id="${id}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  let end = html.length;
  for (const stop of stops) {
    const at = html.indexOf(`id="${stop}"`, start + marker.length);
    if (at >= 0 && at < end) end = at;
  }
  return html.slice(start, end);
}

function spanByClass(html, className) {
  const re = new RegExp(`<span class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</span>`, "g");
  return [...html.matchAll(re)].map((match) => norm(match[1]));
}

function articleBlocks(html, className) {
  return html.match(new RegExp(`<article class="${className}"[\\s\\S]*?</article>`, "g")) || [];
}

function hrefs(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => norm(match[1]));
}

function storedHrefs(links) {
  return (links || []).map((link) => norm(typeof link === "string" ? link : link?.url || link?.href || "")).filter(Boolean);
}

function ddMap(html) {
  const map = new Map();
  const re = /<div class="brf-properties-row"><dt>([^<]*)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd><\/div>/g;
  for (const match of html.matchAll(re)) map.set(norm(match[1]), match[2]);
  return map;
}

function textOf(html) {
  return norm(String(html || "").replace(/<[^>]+>/g, " "));
}

function row(base) {
  return {
    status: "PASS",
    preInbox: "未验证",
    restoration: "none",
    note: "",
    ...base,
  };
}

function titleChain(item) {
  const source = String(item?.title || "");
  const generated = displayTitle(item);
  const baked = /^#\s*\d+\s*[·•]/.test(source.trim());
  return {
    source: norm(source),
    generated: norm(generated),
    generator: baked
      ? "displayTitle strips a baked #N · prefix and a repeated domain only"
      : "displayTitle is identity",
    generatorShortened: norm(source) !== norm(generated) && !baked,
  };
}

function expectVisible(rows, expected, visible, extra) {
  const chain = extra.field === "title" ? titleChain(extra.item) : null;
  const generated = chain ? chain.generated : norm(expected);
  const source = chain ? chain.source : norm(expected);
  const found = visible.find((text) => text === generated);
  const status = found && !chain?.generatorShortened ? "PASS" : "FAIL";
  rows.push(row({
    ...extra,
    item: undefined,
    source,
    generated,
    visible: found || visible[0] || "",
    selector: extra.selector,
    generator: chain?.generator || "identity",
    status,
    note: !found
      ? "visible detail title missing or differs after entity/whitespace normalization"
      : chain?.generatorShortened
        ? "displayTitle dropped characters without a baked #N · prefix"
        : extra.note || "",
  }));
}

function newsLike(rows, spec) {
  const { items, html, emptyNote } = spec;
  if (!items.length) {
    rows.push(row({
      ...spec.meta,
      itemId: null,
      sourceField: spec.sourceField,
      source: "",
      generated: "",
      visible: "",
      selector: spec.detailSelector,
      status: "无样本",
      note: emptyNote,
    }));
    return;
  }
  const cards = new Map(detailCards(items).map((item) => [String(item.id), item]));
  const hot = new Map(hotFromItems(items).map((item) => [String(item.n), item.title]));
  const rest = new Set(remainderNews(items).map((item) => String(item.id)));
  const cardHtml = new Map(articleBlocks(html, "detail-card").map((block) => [
    (block.match(/id="note-([^"]+)"/) || [])[1],
    block,
  ]));
  const hotVisible = spanByClass(html, "hot-title").filter((_, index, list) => list);
  for (const item of items) {
    const id = String(item.id);
    if (cards.has(id)) {
      const block = cardHtml.get(id) || "";
      const visible = spanByClass(block, "detail-title");
      const clipped = /class="[^"]*\bcell-short\b/.test(block);
      expectVisible(rows, item.title, visible, {
        ...spec.meta,
        variant: `${spec.meta.variant}:detail-card`,
        itemId: id,
        sourceField: `${spec.sourceField}[id=${id}].title`,
        selector: spec.detailSelector,
        field: "title",
        item,
        note: clipped ? "detail card still contains cell-short" : "",
      });
      if (clipped) rows[rows.length - 1].status = "FAIL";
      compareIdentityFields(rows, spec, item, block);
    }
    if (hot.has(id)) {
      expectVisible(rows, hot.get(id), hotVisible, {
        ...spec.meta,
        variant: `${spec.meta.variant}:hot`,
        itemId: id,
        sourceField: `${spec.sourceField}[id=${id}].title`,
        selector: spec.hotSelector,
        field: "title",
        item,
        note: "hot jump shows the same generated title; not a table short name",
      });
    }
    if (rest.has(id) || (!cards.has(id) && !hot.has(id))) {
      rows.push(row({
        ...spec.meta,
        variant: `${spec.meta.variant}:table`,
        itemId: id,
        sourceField: `${spec.sourceField}[id=${id}].title`,
        source: norm(item.title),
        generated: norm(displayTitle(item)),
        visible: "",
        selector: "td.col-title .cell-short.is-title",
        status: "N/A",
        note: "remainder is an intentional table short name; no detail card exists for this item",
      }));
    }
  }
}

function compareIdentityFields(rows, spec, item, block) {
  const pairs = ddMap(block);
  const fields = [
    ["Background", item.background],
    ["Facts", item.facts],
    ["Why it matters", item.why],
    ["Architecture impact", item.arch_impact],
    ["Channel", item.channel],
    ["First seen", item.first_source_at],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    const got = textOf(pairs.get(label));
    if (got !== norm(value)) {
      rows.push(row({
        ...spec.meta,
        variant: `${spec.meta.variant}:body`,
        itemId: String(item.id),
        sourceField: `${spec.sourceField}[id=${item.id}].${label}`,
        source: norm(value),
        generated: norm(value),
        visible: got,
        selector: "article.detail-card dd",
        status: "FAIL",
        note: "rendered body differs from the stored field",
      }));
    }
  }
  if (Array.isArray(item.links) && item.links.length) {
    const got = hrefs(pairs.get("Links") || "");
    const want = storedHrefs(item.links);
    if (got.join("\n") !== want.join("\n")) {
      rows.push(row({
        ...spec.meta,
        variant: `${spec.meta.variant}:url`,
        itemId: String(item.id),
        sourceField: `${spec.sourceField}[id=${item.id}].links`,
        source: want.join(" | "),
        generated: want.join(" | "),
        visible: got.join(" | "),
        selector: "article.detail-card dd a[href]",
        status: "FAIL",
        note: "rendered link hrefs differ from the stored links",
      }));
    }
  }
}

function weeklyLead(rows, spec) {
  const items = spec.items;
  if (!items.length) {
    rows.push(row({
      ...spec.meta,
      itemId: null,
      sourceField: spec.sourceField,
      source: "",
      generated: "",
      visible: "",
      selector: spec.detailSelector,
      status: "无样本",
      note: "section has no items",
    }));
    return;
  }
  const lead = takeFeatured(items, 10);
  const rest = takeRest(items, 10);
  const leadIds = new Set(lead.map((item) => String(item.id)));
  const cardHtml = new Map(articleBlocks(spec.html, "detail-card").map((block) => [
    (block.match(/id="note-([^"]+)"/) || [])[1],
    block,
  ]));
  const hotVisible = spanByClass(spec.html, "hot-title");
  for (const item of items) {
    const id = String(item.id);
    if (leadIds.has(id)) {
      const block = cardHtml.get(id) || "";
      expectVisible(rows, item.title, spanByClass(block, "detail-title"), {
        ...spec.meta,
        variant: `${spec.meta.variant}:detail-card`,
        itemId: id,
        sourceField: `${spec.sourceField}[id=${id}].title`,
        selector: spec.detailSelector,
        field: "title",
        item,
      });
      if (/class="[^"]*\bcell-short\b/.test(block)) rows[rows.length - 1].status = "FAIL";
      expectVisible(rows, displayTitle(item), hotVisible, {
        ...spec.meta,
        variant: `${spec.meta.variant}:hot`,
        itemId: id,
        sourceField: `${spec.sourceField}[id=${id}].title`,
        selector: spec.hotSelector,
        field: "title",
        item,
        note: "weekly hot jump uses the same generated title",
      });
      compareIdentityFields(rows, spec, item, block);
    } else if (rest.some((entry) => String(entry.id) === id)) {
      rows.push(row({
        ...spec.meta,
        variant: `${spec.meta.variant}:table`,
        itemId: id,
        sourceField: `${spec.sourceField}[id=${id}].title`,
        source: norm(item.title),
        generated: norm(displayTitle(item)),
        visible: "",
        selector: "td.col-title .cell-short.is-title",
        status: "N/A",
        note: "remainder is an intentional table short name; no detail card",
      }));
    }
  }
}

function paperRows(rows, briefing, html, meta) {
  const papers = briefing.papers || [];
  const panel = sliceFrom(html, "panel-papers", ["panel-github"]);
  if (!papers.length) {
    rows.push(row({
      ...meta,
      section: "papers",
      variant: "papers",
      itemId: null,
      sourceField: "papers",
      source: "",
      generated: "",
      visible: "",
      selector: "article.paper-card h3 .detail-title",
      status: "无样本",
      note: "no papers in this record",
    }));
    return;
  }
  const cap = briefing.date ? 5 : 6;
  const lead = takeFeatured(papers, cap);
  const rest = takeRest(papers, cap);
  const hot = spanByClass(panel, "hot-title");
  const cards = articleBlocks(panel, "paper-card");
  papers.forEach((paper, index) => {
    const keys = Object.keys(paper);
    const longer = keys.filter((key) => /title|name|full/i.test(key) && key !== "short" && norm(paper[key]).length > norm(paper.short).length);
    const base = {
      ...meta,
      section: "papers",
      itemId: String(index + 1),
      sourceField: `papers[${index}].short`,
      source: norm(paper.short),
      generated: norm(paper.short),
      restoration: longer.length
        ? `longer sibling present: ${longer.join(",")}`
        : "no longer sibling in JSON; papers.short is the only name field; pre-inbox source unavailable",
    };
    const leadIndex = lead.indexOf(paper);
    if (leadIndex >= 0) {
      const card = cards[leadIndex] || "";
      const visible = spanByClass(card, "detail-title");
      const hotHtml = (panel.match(/<ol class="hot hot-list">[\s\S]*?<\/ol>/) || [""])[0];
      const hotText = hot[leadIndex] || "";
      rows.push(row({
        ...base,
        variant: "papers:hot",
        visible: hotText,
        selector: "#papers-hot .hot-title.detail-title",
        status: hotText === base.generated && !/cell-short/.test(hotHtml) ? "PASS" : "FAIL",
        note: longer.length ? "do not invent; report the sibling instead of restoring" : "stored short is the detail title; no characters added",
      }));
      rows.push(row({
        ...base,
        variant: "papers:card",
        visible: visible[0] || "",
        selector: "article.paper-card h3 .detail-title",
        status: visible[0] === base.generated && !/class="[^"]*\bcell-short\b/.test(card) ? "PASS" : "FAIL",
        note: longer.length ? "do not invent; report the sibling instead of restoring" : "stored short is the detail title; no characters added",
      }));
      const fields = paperFields(paper);
      const pairs = ddMap(card);
      for (const [label, value, field] of [
        ["What", fields.grabbed, "what"],
        ["Points", fields.points, "points"],
        ["Why read", fields.why, "why"],
      ]) {
        const got = textOf(pairs.get(label));
        if (got !== norm(value)) {
          rows.push(row({
            ...base,
            variant: "papers:body",
            sourceField: `papers[${index}].${field}`,
            source: norm(paper[field] || paper.what || ""),
            generated: norm(value),
            visible: got,
            selector: "article.paper-card dd",
            status: "FAIL",
            note: "rendered paper body differs from paperFields",
          }));
        }
      }
      const gotLinks = hrefs(pairs.get("Links") || "");
      const want = [paper.url, paper.dair_url].filter(Boolean).map((href) => norm(href));
      if (gotLinks.join("\n") !== want.join("\n")) {
        rows.push(row({
          ...base,
          variant: "papers:url",
          sourceField: `papers[${index}].url`,
          source: want.join(" | "),
          generated: want.join(" | "),
          visible: gotLinks.join(" | "),
          selector: "article.paper-card a[href]",
          status: "FAIL",
          note: "rendered paper URLs differ",
        }));
      }
    } else if (rest.includes(paper)) {
      rows.push(row({
        ...base,
        variant: "papers:table",
        visible: "",
        selector: "#papers-rest td.col-short .cell-short",
        status: "N/A",
        note: "past the featured cap; intentional table short name; no detail card",
      }));
    }
  });
}

function githubRows(rows, briefing, html, meta) {
  const github = briefing.github || {};
  const panel = sliceFrom(html, "panel-github", ["panel-appendix", "panel-decisions"]);
  for (const kind of ["rising", "newcomers"]) {
    const items = github[kind] || [];
    const subId = kind === "rising" ? "gh-rising" : "gh-newcomers";
    const sub = sliceFrom(panel, subId, ["gh-newcomers", "gh-summary", "panel-appendix", "panel-decisions"]);
    if (!items.length) {
      rows.push(row({
        ...meta,
        section: "github",
        variant: `github:${kind}`,
        itemId: null,
        sourceField: `github.${kind}`,
        source: "",
        generated: "",
        visible: "",
        selector: `article.gh-detail h3 .detail-title`,
        status: "无样本",
        note: `${kind} list is empty; no sample, not a pass`,
      }));
      continue;
    }
    const lead = takeFeatured(items, 5);
    const rest = takeRest(items, 5);
    const details = articleBlocks(sub, "gh-detail");
    const rowTitles = spanByClass(sub.match(/<ol class="brf-rows">[\s\S]*?<\/ol>/)?.[0] || "", "brf-row-title");
    for (const item of items) {
      const id = `${kind}:${item.rank}`;
      const keys = Object.keys(item);
      const longer = keys.filter((key) => /title|name|full/i.test(key) && key !== "repo" && norm(item[key]).length > norm(item.repo).length);
      const base = {
        ...meta,
        section: "github",
        itemId: id,
        sourceField: `github.${kind}[rank=${item.rank}].repo`,
        source: norm(item.repo),
        generated: norm(item.repo),
        restoration: longer.length
          ? `longer sibling present: ${longer.join(",")}`
          : "repo is the stored name; no longer title sibling; pre-inbox source unavailable",
      };
      const leadIndex = lead.indexOf(item);
      if (leadIndex >= 0) {
        const card = details.find((block) => block.includes(`id="gh-${kind === "newcomers" ? "newcomer" : "rising"}-${item.rank}"`)) || "";
        const heading = spanByClass(card, "detail-title")[0] || "";
        rows.push(row({
          ...base,
          variant: `github:${kind}:row`,
          visible: rowTitles[leadIndex] || "",
          selector: `#${subId} .brf-row-title`,
          status: (rowTitles[leadIndex] || "") === base.generated ? "PASS" : "FAIL",
          note: "lead row is the section title, not the table short name",
        }));
        rows.push(row({
          ...base,
          variant: `github:${kind}:detail`,
          visible: heading,
          selector: `article.gh-detail h3 .detail-title`,
          status: heading === base.generated && !/class="[^"]*\bcell-short\b/.test(card) ? "PASS" : "FAIL",
          note: "detail heading is the stored repo; no characters added",
        }));
        const pairs = ddMap(card);
        if (item.what && textOf(pairs.get("What")) !== norm(item.what)) {
          rows.push(row({
            ...base,
            variant: `github:${kind}:body`,
            sourceField: `github.${kind}[rank=${item.rank}].what`,
            source: norm(item.what),
            generated: norm(item.what),
            visible: textOf(pairs.get("What")),
            selector: "article.gh-detail dd",
            status: "FAIL",
            note: "rendered GitHub what differs",
          }));
        }
        if (item.why && textOf(pairs.get("Why it rose")) !== norm(item.why)) {
          rows.push(row({
            ...base,
            variant: `github:${kind}:body`,
            sourceField: `github.${kind}[rank=${item.rank}].why`,
            source: norm(item.why),
            generated: norm(item.why),
            visible: textOf(pairs.get("Why it rose")),
            selector: "article.gh-detail dd",
            status: "FAIL",
            note: "rendered GitHub why differs",
          }));
        }
        const got = hrefs(pairs.get("Links") || "");
        if (item.url && got[0] !== norm(item.url)) {
          rows.push(row({
            ...base,
            variant: `github:${kind}:url`,
            sourceField: `github.${kind}[rank=${item.rank}].url`,
            source: norm(item.url),
            generated: norm(item.url),
            visible: got[0] || "",
            selector: "article.gh-detail a[href]",
            status: "FAIL",
            note: "rendered GitHub URL differs",
          }));
        }
      } else if (rest.includes(item)) {
        rows.push(row({
          ...base,
          variant: `github:${kind}:table`,
          visible: "",
          selector: "td.col-short .cell-short",
          status: "N/A",
          note: "past the featured cap; intentional table short name; no detail card",
        }));
      }
    }
  }
  rows.push(row({
    ...meta,
    section: "github",
    variant: "github:summary",
    itemId: null,
    sourceField: "github.meta",
    source: "",
    generated: "",
    visible: "",
    selector: "#gh-summary",
    status: "N/A",
    note: "summary subpanel has no per-item detail title",
  }));
}

function appendixRows(rows, briefing, html, meta) {
  if (briefing.week) {
    rows.push(row({
      ...meta,
      section: "appendix",
      variant: "appendix",
      itemId: null,
      sourceField: "",
      source: "",
      generated: "",
      visible: "",
      selector: "#panel-appendix",
      status: "N/A",
      note: "weekly template has Decisions instead of Appendix; no appendix detail cards were added",
    }));
    return;
  }
  const items = [...(briefing.news || []), ...(briefing.polfin || [])];
  if (!items.length) {
    rows.push(row({
      ...meta,
      section: "appendix",
      variant: "appendix",
      itemId: null,
      sourceField: "news+polfin",
      source: "",
      generated: "",
      visible: "",
      selector: "#panel-appendix .cell-short.is-title",
      status: "无样本",
      note: "appendix table has no rows",
    }));
    return;
  }
  for (const item of items) {
    const lane = (briefing.polfin || []).includes(item) ? "polfin" : "news";
    rows.push(row({
      ...meta,
      section: "appendix",
      variant: "appendix:table",
      itemId: `${lane}:${item.id}`,
      sourceField: `${lane}[id=${item.id}].title`,
      source: norm(item.title),
      generated: norm(displayTitle(item)),
      visible: "",
      selector: "#panel-appendix td.col-title .cell-short.is-title",
      status: "N/A",
      note: "appendix is table-only; short name stays .cell-short.is-title; no detail card invented",
    }));
  }
  if (!html.includes('id="panel-appendix"')) {
    rows.push(row({
      ...meta,
      section: "appendix",
      variant: "appendix:missing",
      itemId: null,
      sourceField: "",
      source: "",
      generated: "",
      visible: "",
      selector: "#panel-appendix",
      status: "FAIL",
      note: "daily page is missing the appendix panel",
    }));
  }
}

function decisionRows(rows, briefing, html, meta) {
  if (briefing.date) {
    rows.push(row({
      ...meta,
      section: "decisions",
      variant: "decisions",
      itemId: null,
      sourceField: "decisions",
      source: "",
      generated: "",
      visible: "",
      selector: "article.decision > h3",
      status: "N/A",
      note: "daily template has no decisions panel",
    }));
    return;
  }
  const decisions = briefing.decisions || [];
  const panel = sliceFrom(html, "panel-decisions", ["panel-end-missing"]);
  if (!decisions.length) {
    rows.push(row({
      ...meta,
      section: "decisions",
      variant: "decisions",
      itemId: null,
      sourceField: "decisions",
      source: "",
      generated: "",
      visible: "",
      selector: "article.decision > h3",
      status: "无样本",
      note: "no decision cards",
    }));
    return;
  }
  const blocks = articleBlocks(panel, "decision");
  decisions.forEach((card, index) => {
    const block = blocks[index] || "";
    const heading = textOf((block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    const generated = norm(`${index + 1}. ${card.title}`);
    rows.push(row({
      ...meta,
      section: "decisions",
      variant: "decisions:card",
      itemId: String(index + 1),
      sourceField: `decisions[${index}].title`,
      source: norm(card.title),
      generated,
      visible: heading,
      selector: "article.decision > h3",
      status: heading === generated && !/cell-short/.test(block.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/)?.[0] || "") ? "PASS" : "FAIL",
      note: "decision heading already renders the stored title; CSS has no ellipsis or max-width",
    }));
    const pairs = ddMap(block);
    const facts = textOf(pairs.get("Facts"));
    if (card.happened && facts !== norm(card.happened)) {
      rows.push(row({
        ...meta,
        section: "decisions",
        variant: "decisions:body",
        itemId: String(index + 1),
        sourceField: `decisions[${index}].happened`,
        source: norm(card.happened),
        generated: norm(card.happened),
        visible: facts,
        selector: "article.decision dd",
        status: "FAIL",
        note: "rendered decision facts differ",
      }));
    }
  });
  const steps = saSteps(decisions);
  const stepText = [...panel.matchAll(/<p class="brf-step-title"[^>]*>([\s\S]*?)<\/p>/g)].map((match) => textOf(match[1]));
  steps.forEach((step, index) => {
    const generated = norm(`${step.level} · ${step.title}`);
    rows.push(row({
      ...meta,
      section: "decisions",
      variant: "decisions:sa-step",
      itemId: `step:${index + 1}`,
      sourceField: `decisions[].actions_${step.level.toLowerCase()}[${index}]`,
      source: norm(step.title),
      generated,
      visible: stepText[index] || "",
      selector: "p.brf-step-title",
      status: stepText[index] === generated ? "PASS" : "FAIL",
      note: "SA line is the stored action; not a shortened table name",
    }));
  });
}

function summaryRow(rows, briefing, html, meta) {
  const visible = textOf((html.match(/<p class="brf-callout-body"[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
  rows.push(row({
    ...meta,
    section: "summary",
    variant: "summary",
    itemId: null,
    sourceField: "summary",
    source: norm(briefing.summary),
    generated: norm(briefing.summary),
    visible,
    selector: "#conclusion .brf-callout-body",
    status: visible === norm(briefing.summary) ? "PASS" : "FAIL",
    note: "page summary is content, compared for semantic stability",
  }));
}

function cssInventory(css) {
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
    return match ? match[0] : "";
  };
  const grouped = css.match(/\.detail-card \.card-title,[\s\S]*?\.gh-detail > h3 \{[^}]*\}/)?.[0] || "";
  return [
    {
      layer: "css",
      selector: ".cell-short",
      intentional: true,
      appliesTo: "table short names and any leftover compact cell",
      evidence: block(".cell-short").includes("text-overflow: ellipsis") ? "nowrap + ellipsis + 16ch" : "MISSING",
    },
    {
      layer: "css",
      selector: ".cell-short.is-title",
      intentional: true,
      appliesTo: "news, polfin, and appendix table title column",
      evidence: block(".cell-short.is-title").includes("32ch") ? "max-width 32ch" : "MISSING",
    },
    {
      layer: "css",
      selector: ".cell-link",
      intentional: true,
      appliesTo: "table link labels",
      evidence: block(".cell-link").includes("ellipsis") ? "ellipsis 12ch" : "MISSING",
    },
    {
      layer: "css",
      selector: ".detail-title",
      intentional: false,
      appliesTo: "news/polfin detail titles, paper hot and card titles, GitHub detail heading",
      evidence: block(".detail-title"),
    },
    {
      layer: "css",
      selector: ".paper-card .card-title",
      intentional: false,
      appliesTo: "paper detail card heading",
      evidence: grouped.includes(".paper-card .card-title") ? "included in the natural-wrap heading rule" : "MISSING",
    },
    {
      layer: "css",
      selector: ".hot-title.detail-title",
      intentional: false,
      appliesTo: "paper hot jump only; base .hot-title is unchanged",
      evidence: block(".hot-title.detail-title"),
    },
    {
      layer: "css",
      selector: ".brf-row-title",
      intentional: false,
      appliesTo: "GitHub lead row title",
      evidence: block(".brf-row-title"),
    },
    {
      layer: "css",
      selector: ".gh-detail > h3",
      intentional: false,
      appliesTo: "GitHub detail heading",
      evidence: grouped.includes(".gh-detail > h3") ? "included in the natural-wrap heading rule" : "MISSING",
    },
    {
      layer: "css",
      selector: ".decision > h3",
      intentional: false,
      appliesTo: "weekly decision heading",
      evidence: `${block(".decision > h3")} | inherits body overflow-wrap: break-word; no ellipsis`,
    },
    {
      layer: "generator",
      selector: "displayTitle",
      intentional: true,
      appliesTo: "news and polfin titles",
      evidence: "strips a baked #N · prefix and a repeated domain; does not clip length",
    },
    {
      layer: "generator",
      selector: "clipChars / linkLabel",
      intentional: true,
      appliesTo: "link labels, max 12 characters",
      evidence: "not applied to detail titles",
    },
    {
      layer: "generator",
      selector: "excerpt",
      intentional: true,
      appliesTo: "homepage blurbs",
      evidence: "not applied to daily/weekly detail titles",
    },
    {
      layer: "stored-source",
      selector: "papers[].short / github[].repo",
      intentional: false,
      appliesTo: "paper and GitHub names",
      evidence: "no longer sibling field in the published JSON; pre-inbox text unavailable; nothing restored",
    },
  ];
}

export function auditDetailTitles(root) {
  const css = fs.readFileSync(path.join(root, "src/css/site.css"), "utf8");
  const rows = [];
  for (const route of ROUTES) {
    const briefing = JSON.parse(fs.readFileSync(path.join(root, route.content), "utf8"));
    const html = fs.readFileSync(path.join(root, route.html), "utf8");
    const meta = { route: route.route, period: route.period, content: route.content, html: route.html };
    summaryRow(rows, briefing, html, meta);
    const split = hasWaveSplit(briefing);
    if (route.period === "daily" && split) {
      for (const [bucket, id, stop] of [
        ["morning", "wave-morning", "wave-afternoon"],
        ["afternoon", "wave-afternoon", "panel-polfin"],
      ]) {
        newsLike(rows, {
          items: waveItems(briefing.news || [], bucket),
          html: sliceFrom(html, id, [stop]),
          emptyNote: `${bucket} news subpanel has no items; no sample, not a pass`,
          sourceField: "news",
          detailSelector: "article.detail-card h3 .detail-title",
          hotSelector: ".hot-title",
          meta: { ...meta, section: "news", variant: `news:${bucket}` },
        });
      }
    } else if (route.period === "daily") {
      newsLike(rows, {
        items: briefing.news || [],
        html: sliceFrom(html, "panel-news", ["panel-polfin"]),
        emptyNote: "news panel has no items",
        sourceField: "news",
        detailSelector: "article.detail-card h3 .detail-title",
        hotSelector: ".hot-title",
        meta: { ...meta, section: "news", variant: "news" },
      });
    } else {
      weeklyLead(rows, {
        items: briefing.news || [],
        html: sliceFrom(html, "panel-news", ["panel-polfin"]),
        sourceField: "news",
        detailSelector: "article.detail-card h3 .detail-title",
        hotSelector: "#weekly-news-hot .hot-title",
        meta: { ...meta, section: "news", variant: "news" },
      });
    }
    if (route.period === "daily") {
      for (const [bucket, id, stop] of [
        ["morning", "pf-wave-morning", "pf-wave-afternoon"],
        ["afternoon", "pf-wave-afternoon", "panel-papers"],
      ]) {
        newsLike(rows, {
          items: waveItems(briefing.polfin || [], bucket),
          html: sliceFrom(html, id, [stop]),
          emptyNote: `${bucket} politics subpanel has no items; no sample, not a pass`,
          sourceField: "polfin",
          detailSelector: "article.detail-card h3 .detail-title",
          hotSelector: ".hot-title",
          meta: { ...meta, section: "polfin", variant: `polfin:${bucket}` },
        });
      }
    } else {
      weeklyLead(rows, {
        items: briefing.polfin || [],
        html: sliceFrom(html, "panel-polfin", ["panel-papers"]),
        sourceField: "polfin",
        detailSelector: "article.detail-card h3 .detail-title",
        hotSelector: "#polfin-hot .hot-title",
        meta: { ...meta, section: "polfin", variant: "polfin" },
      });
    }
    paperRows(rows, briefing, html, meta);
    githubRows(rows, briefing, html, meta);
    appendixRows(rows, briefing, html, meta);
    decisionRows(rows, briefing, html, meta);
  }
  const inventory = cssInventory(css);
  if (inventory.some((entry) => entry.evidence === "MISSING" || String(entry.evidence).includes("MISSING"))) {
    rows.push(row({
      route: "*",
      period: "*",
      content: "src/css/site.css",
      html: "src/css/site.css",
      section: "css",
      variant: "css:inventory",
      itemId: null,
      sourceField: "src/css/site.css",
      source: "",
      generated: "",
      visible: "",
      selector: inventory.filter((entry) => String(entry.evidence).includes("MISSING")).map((entry) => entry.selector).join(", "),
      status: "FAIL",
      note: "a required CSS rule is missing",
    }));
  }
  const counts = { PASS: 0, FAIL: 0, "N/A": 0, "无样本": 0 };
  for (const entry of rows) counts[entry.status] = (counts[entry.status] || 0) + 1;
  return {
    normalization: "entity decode + whitespace collapse only",
    preInbox: "repository equality is not evidence that a title was complete before the inbox; every row stays 未验证",
    routes: ROUTES.map((route) => route.route),
    selectors: {
      newsDetail: "article.detail-card h3 .detail-title",
      newsHot: ".hot-title",
      paperHot: "#papers-hot .hot-title.detail-title",
      paperCard: "article.paper-card h3 .detail-title",
      paperTable: "#papers-rest td.col-short .cell-short",
      githubRow: ".brf-row-title",
      githubDetail: "article.gh-detail h3 .detail-title",
      githubTable: "td.col-short .cell-short",
      appendix: "#panel-appendix td.col-title .cell-short.is-title",
      decision: "article.decision > h3",
      saStep: "p.brf-step-title",
    },
    inventory,
    counts,
    failures: rows.filter((entry) => entry.status === "FAIL"),
    rows,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = auditDetailTitles(path.resolve(import.meta.dirname, ".."));
  const out = process.argv[2];
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (out) fs.writeFileSync(out, body);
  console.log(JSON.stringify({ counts: report.counts, failures: report.failures.length }, null, 2));
  if (report.failures.length) process.exit(1);
}
