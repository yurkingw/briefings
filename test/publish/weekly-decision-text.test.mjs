import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import nunjucks from "nunjucks";
import { finalJudgments, saSteps, textList } from "../../lib/pages-parity.js";
import { textLang } from "../../lib/ui-labels.js";

const labels = {
  hardGate: "Hard",
  facts: "Facts",
  judgment: "Judgment",
  whyItMatters: "Why it matters",
  architectureImpact: "Architecture impact",
  controlDomains: "Control domains",
  costTradeoff: "Cost tradeoff",
  finalJudgment: "Final",
  saActions: "Actions",
};

function decisionLoop() {
  const src = fs.readFileSync("src/_includes/briefing.njk", "utf8");
  const start = src.indexOf("{% for card in decisions %}");
  const end = src.indexOf("{% endfor %}", start);
  assert.ok(start >= 0 && end > start);
  return src.slice(start, end + "{% endfor %}".length);
}

function render(card) {
  const env = new nunjucks.Environment(null, { autoescape: true });
  env.addFilter("textLang", textLang);
  env.addFilter("saSteps", saSteps);
  env.addFilter("finalJudgments", finalJudgments);
  env.addFilter("textList", textList);
  env.addFilter("financeLead", () => "lead");
  const template = `
    {% set steps = decisions | saSteps %}
    {% set judgments = decisions | finalJudgments %}
    ${decisionLoop()}
    {% for step in steps %}<step>{{ step.level }}|{{ step.title }}</step>{% endfor %}
    {% for line in judgments %}<judge>{{ line }}</judge>{% endfor %}
  `;
  return env.renderString(template, { decisions: [card], labels, briefing: { decisions: [card] } });
}

test("a string decision renders the whole sentence and does not hit arr.join", () => {
  const judgment = "整句判断不拆字";
  const domains = "域甲、域乙";
  const action = "整句动作不拆字";
  let html = "";
  try {
    html = render({
      title: "题",
      happened: "事",
      why: "因",
      arch_impact: "构",
      judgment,
      control_domains: domains,
      actions_p0: action,
      actions_p1: "",
      actions_p2: "",
    });
  } catch (error) {
    assert.match(`${error.name}: ${error.message}`, /TypeError: arr\.join is not a function/);
    assert.fail("string judgment still reaches nunjucks join");
  }
  assert.match(html, new RegExp(judgment));
  assert.match(html, new RegExp(domains));
  assert.match(html, /<step>P0\|整句动作不拆字<\/step>/);
  assert.equal(html.match(/<step>/g).length, 1);
  assert.match(html, /<judge>整句判断不拆字<\/judge>/);
});

test("array decision fields keep the existing separators", () => {
  const html = render({
    title: "题",
    happened: "事",
    why: "因",
    arch_impact: "构",
    judgment: ["甲", "乙"],
    control_domains: ["域1", "域2"],
    actions_p0: ["动作甲", "动作乙"],
    actions_p1: [],
    actions_p2: ["动作丙"],
  });
  assert.match(html, /甲；乙/);
  assert.match(html, /域1、域2/);
  assert.match(html, /<step>P0\|动作甲<\/step>/);
  assert.match(html, /<step>P0\|动作乙<\/step>/);
  assert.match(html, /<step>P2\|动作丙<\/step>/);
  assert.equal(html.match(/<step>/g).length, 3);
  assert.match(html, /<judge>甲<\/judge>/);
  assert.match(html, /<judge>乙<\/judge>/);
});

test("public W46 decisions render as whole strings", () => {
  const weekly = JSON.parse(fs.readFileSync("content/weekly/2026-W46.json", "utf8"));
  assert.equal(weekly.week, "2026-W46");
  assert.equal(weekly.updated_at, "2026-11-13T18:36:00+08:00");
  for (const card of weekly.decisions) {
    assert.equal(typeof card.judgment, "string");
    assert.equal(typeof card.control_domains, "string");
    const html = render(card);
    assert.match(html, new RegExp(card.judgment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(card.control_domains.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const key of ["actions_p0", "actions_p1", "actions_p2"]) {
      if (!card[key]) continue;
      assert.equal(typeof card[key], "string");
      assert.match(html, new RegExp(`<step>P${key.slice(-1)}\\|${card[key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</step>`));
    }
  }
});
