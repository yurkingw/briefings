import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "briefings-publish-"));
}

export function dailyObject(overrides = {}) {
  return {
    schema: "qianji.briefing.daily.v1",
    date: "2026-11-10",
    timezone: "Asia/Shanghai",
    updated_at: "2026-11-10T08:00:00+08:00",
    wave: "晨间",
    summary: "合成结论",
    metrics: {
      news: 1,
      finsec: 0,
      papers: 0,
      gh_rising: 1,
      gh_newcomers: 1,
      home_related: "1/2",
      news_morning: 1,
      news_noon: 0,
    },
    news: [
      {
        id: 1,
        wave: "晨间",
        domain: "合成",
        title: "一条",
        background: "背景",
        facts: "事实",
        why: "原因",
        arch_impact: null,
        channel: "合成通道",
        first_source_at: "2026-11-10T01:00:00+08:00",
        links: [],
        finsec: false,
        hard_gate: false,
        detail: false,
      },
    ],
    polfin: [
      {
        id: "pf-1",
        wave: "晨间",
        angle: "other",
        title: "合成角",
        hard_gate: false,
        detail: false,
      },
    ],
    papers: [
      {
        short: "P",
        what: "什么",
        why: "为何",
        url: "https://example.com/paper",
        dair_url: null,
      },
    ],
    github: {
      rising: [
        {
          rank: 1,
          repo: "synthetic-rising",
          owner: "example",
          gained: 3,
          stars: 10,
          age_h: null,
          what: "什么",
          why: "为何",
          slogan: "",
          license: "",
        },
      ],
      newcomers: [
        {
          rank: 1,
          repo: "synthetic-new",
          owner: "example",
          gained: null,
          stars: 4,
          age_h: 12.5,
          what: "什么",
          why: "为何",
        },
      ],
      meta: { archive: "missing", archive_note: "合成缺源" },
    },
    sources: ["synthetic"],
    ...overrides,
  };
}

export function dailyRaw(overrides = {}) {
  return Buffer.from(`${JSON.stringify(dailyObject(overrides))}\n`);
}

export function weeklyObject(overrides = {}) {
  return {
    schema: "qianji.briefing.weekly.v1",
    week: "2026-W46",
    timezone: "Asia/Shanghai",
    updated_at: "2026-11-13T18:00:00+08:00",
    window: { start: "2026-11-09", end: "2026-11-13", note: "合成窗" },
    summary: "周合成",
    metrics: {
      news_featured: 1,
      polfin: 1,
      papers_featured: 1,
      gh_rising: 1,
      gh_newcomers: 1,
      decisions: 1,
    },
    news: [
      {
        id: 1,
        title: "周条目",
        domain: "合成",
        why: "原因",
        background: "背景",
        facts: "事实",
        detail: true,
        finsec: false,
        hard_gate: false,
        links: ["https://example.com/news"],
      },
    ],
    polfin: [
      {
        id: "pf-w",
        angle: "other",
        title: "周角",
        background: "背景",
        facts: "事实",
        why: "原因",
        hard_gate: false,
        detail: false,
      },
    ],
    papers: [{ short: "P", what: "什么", why: "为何", url: "https://example.com/paper" }],
    github: {
      rising: [
        {
          rank: 1,
          repo: "synthetic-rising",
          owner: "example",
          slogan: "口号",
          gained: 5,
          gained_week_approx: 9,
          stars: 20,
          what: "什么",
          why: "为何",
          url: "https://github.com/example/synthetic-rising",
        },
      ],
      newcomers: [
        {
          rank: 1,
          repo: "synthetic-new",
          owner: "example",
          stars: 2,
          what: "什么",
          why: "为何",
          gained: null,
          url: "https://github.com/example/synthetic-new",
        },
      ],
      meta: { archive: "missing", note: "合成" },
    },
    decisions: [
      {
        title: "决策",
        happened: "发生",
        why: "原因",
        arch_impact: "影响",
        control_domains: ["合成"],
        actions_p0: [],
        actions_p1: [],
        actions_p2: [],
        judgment: ["判断"],
      },
    ],
    sources: ["synthetic"],
    gaps: ["合成缺口"],
    news_digest: "合成摘要",
    ...overrides,
  };
}

export function weeklyRaw(overrides = {}) {
  return Buffer.from(`${JSON.stringify(weeklyObject(overrides))}\n`);
}
