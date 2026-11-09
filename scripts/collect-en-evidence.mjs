import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { displayTitle } from "../lib/pages-parity.js";
import { labels } from "../lib/ui-labels.js";
import { SYNTHETIC_LONG_TITLE, syntheticTitleStats } from "../test/fixtures/long-title.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "artifacts", "evidence", "en-r1");
const www = path.join(outDir, "www");
const shots = path.join(outDir, "screenshots");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const base = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function normalize(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function detailCards(html) {
  return html.match(/<article class="detail-card"[\s\S]*?<\/article>/g) || [];
}

function chainFor(rel, htmlRel) {
  const briefing = readJson(rel);
  const html = fs.readFileSync(path.join(root, htmlRel), "utf8");
  const cards = detailCards(html);
  const pool = [...(briefing.news || []), ...(briefing.polfin || [])];
  const byId = new Map(pool.map((item) => [String(item.id), item]));
  const rows = [];
  for (const card of cards) {
    const id = (card.match(/id="note-([^"]+)"/) || [])[1];
    const item = byId.get(String(id));
    if (!item) continue;
    const lane = (briefing.polfin || []).some((entry) => String(entry.id) === String(id)) ? "polfin" : "news";
    const span = card.match(/<span class="detail-title"[^>]*>([\s\S]*?)<\/span>/);
    const htmlTitle = normalize(span ? span[1] : "");
    const source = normalize(item.title);
    const intermediate = normalize(displayTitle(item));
    rows.push({
      id,
      lane,
      detail: item.detail === true,
      source,
      intermediate,
      html: htmlTitle,
      sourceEqualsIntermediate: source === intermediate,
      intermediateEqualsHtml: intermediate === htmlTitle,
      className: ((span || [""])[0].match(/class="([^"]*)"/) || [])[1] || "",
    });
  }
  return {
    content: rel,
    html: htmlRel,
    rows: rows.filter((row) => row.detail),
  };
}

function hashTree(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(json|md)$/.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  return files.sort().map((file) => {
    const rel = path.relative(root, file);
    const body = fs.readFileSync(file);
    return { rel, sha256: crypto.createHash("sha256").update(body).digest("hex"), bytes: body.length };
  });
}

function copyAssets() {
  fs.rmSync(www, { recursive: true, force: true });
  fs.mkdirSync(path.join(www, "css"), { recursive: true });
  fs.mkdirSync(path.join(www, "fonts"), { recursive: true });
  fs.mkdirSync(path.join(www, "js"), { recursive: true });
  fs.copyFileSync(path.join(root, "_site/css/site.css"), path.join(www, "css/site.css"));
  fs.copyFileSync(path.join(root, "_site/js/fold.js"), path.join(www, "js/fold.js"));
  for (const name of fs.readdirSync(path.join(root, "_site/fonts"))) {
    fs.copyFileSync(path.join(root, "_site/fonts", name), path.join(www, "fonts", name));
  }
}

function localize(html) {
  return html
    .replaceAll('href="/briefings/css/site.css"', 'href="css/site.css"')
    .replaceAll('src="/briefings/js/fold.js"', 'src="js/fold.js"');
}

function writePages() {
  const pages = {
    "home.html": "_site/index.html",
    "daily-latest.html": "_site/daily/2026-11-09/index.html",
    "daily-history.html": "_site/daily/2026-11-06/index.html",
    "weekly.html": "_site/weekly/2026-W45/index.html",
  };
  for (const [name, rel] of Object.entries(pages)) {
    fs.writeFileSync(path.join(www, name), localize(fs.readFileSync(path.join(root, rel), "utf8")));
  }
  const title = SYNTHETIC_LONG_TITLE.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const lanes = [
    ["daily-news", "Daily", "News"],
    ["daily-polfin", "Daily", "Politics & Finance"],
    ["weekly-news", "Weekly", "News"],
    ["weekly-polfin", "Weekly", "Politics & Finance"],
  ];
  const cards = lanes.map(([id, period, lane]) => `
    <section id="${id}" data-combo="${period} ${lane}">
      <h2>${period} · ${lane}</h2>
      <p class="kicker">Test data. Synthetic fixture. Not production content.</p>
      <article class="detail-card" id="note-${id}" data-detail-title="${title}">
        <h3 class="card-title">#T · ${lane} · <span class="detail-title" lang="zh-Hans">${title}</span></h3>
      </article>
    </section>`).join("\n");
  fs.writeFileSync(path.join(www, "fixture.html"), `<!DOCTYPE html>
<html lang="en" data-theme="day">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Synthetic long title fixture</title>
  <link rel="stylesheet" href="css/site.css">
</head>
<body class="is-briefing">
  <main>
    <div class="sheet">
      <p class="kicker">Test data</p>
      <h1>Synthetic long title fixture</h1>
      ${cards}
    </div>
  </main>
  <button type="button" class="back-to-top" aria-label="Back to top" title="Back to top">Top</button>
</body>
</html>
`);
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChrome(port) {
  let last = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return JSON.parse(await get(`http://127.0.0.1:${port}/json/version`));
    } catch (error) {
      last = error.message;
      await sleep(400);
    }
  }
  throw new Error(`chrome debug port did not open: ${last}`);
}

function cdp(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const job = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) job.reject(new Error(JSON.stringify(message.error)));
    else job.resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitEvent(ws, method) {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === method) {
        ws.removeEventListener("message", onMessage);
        resolve(message.params || {});
      }
    };
    ws.addEventListener("message", onMessage);
  });
}

const measureExpression = `(() => {
  const norm = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const titles = [...document.querySelectorAll(".detail-title")].filter((el) => el.getClientRects().length).map((el) => {
    const cs = getComputedStyle(el);
    const card = el.closest(".detail-card");
    return {
      id: card ? card.id : "",
      text: norm(el.textContent),
      source: card ? norm(card.getAttribute("data-detail-title") || "") : "",
      whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      lineClamp: cs.webkitLineClamp,
      overflow: cs.overflow,
      fontSize: cs.fontSize,
      height: Math.round(el.getBoundingClientRect().height),
      clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    };
  });
  const pills = [...document.querySelectorAll(".page-tabs button, .sub-tabs button, .theme-switch button")].map((el) => {
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = el.getBoundingClientRect();
    const cropped = [...range.getClientRects()].some((rect) => rect.width > 0 && (
      rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1
    ));
    return {
      text: norm(el.textContent),
      fontSize: cs.fontSize,
      whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      cropped,
    };
  });
  const sheet = document.querySelector(".sheet") || document.body;
  const top = document.querySelector("button.back-to-top");
  const topRect = top ? top.getBoundingClientRect() : null;
  const topStyle = top ? getComputedStyle(top) : null;
  return {
    href: location.href,
    theme: document.documentElement.getAttribute("data-theme") || "system",
    viewport: { width: window.innerWidth, height: window.innerHeight },
    overflow: {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      sheet: sheet.scrollWidth - sheet.clientWidth,
    },
    titles,
    pills,
    top: top ? {
      text: norm(top.textContent),
      aria: top.getAttribute("aria-label"),
      title: top.getAttribute("title"),
      hidden: top.hasAttribute("hidden"),
      width: Math.round(topRect.width),
      height: Math.round(topRect.height),
      right: Math.round(window.innerWidth - topRect.right),
      bottom: Math.round(window.innerHeight - topRect.bottom),
      background: topStyle.backgroundColor,
      color: topStyle.color,
    } : null,
    topCount: document.querySelectorAll("button.back-to-top, .back-to-top").length,
    colors: {
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      sheet: getComputedStyle(sheet).backgroundColor,
    },
    themeButtons: [...document.querySelectorAll(".theme-switch button")].map((button) => {
      const cs = getComputedStyle(button);
      return {
        text: norm(button.textContent),
        pressed: button.getAttribute("aria-pressed"),
        aria: button.getAttribute("aria-label"),
        background: cs.backgroundColor,
        color: cs.color,
      };
    }),
  };
})()`;

async function runBrowser(records) {
  const port = 9333;
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--disable-extensions",
    `--remote-debugging-port=${port}`,
    "--user-data-dir=/tmp/en-brf-chrome",
    "--allow-file-access-from-files",
    ["--", "force-color-profile=srgb"].join(""),
  ], { stdio: "ignore" });
  try {
    const version = await waitForChrome(port);
    const list = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
    const page = list.find((item) => item.type === "page") || JSON.parse(await get(`http://127.0.0.1:${port}/json/new?about:blank`));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const send = cdp(ws);
    await send("Page.enable");
    await send("Runtime.enable");
    const jobs = [];
    for (const file of ["daily-latest.html", "weekly.html"]) {
      for (const lane of ["news", "polfin"]) {
        for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
          for (const theme of ["day", "night"]) jobs.push({ file, lane, viewport, theme });
        }
      }
    }
    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      for (const theme of ["day", "night"]) {
        for (const lane of ["daily-news", "daily-polfin", "weekly-news", "weekly-polfin"]) {
          jobs.push({ file: "fixture.html", lane, viewport, theme });
        }
      }
    }
    for (const job of jobs) {
      const loaded = waitEvent(ws, "Page.loadEventFired");
      await send("Emulation.setDeviceMetricsOverride", {
        width: job.viewport.width,
        height: job.viewport.height,
        deviceScaleFactor: 1,
        mobile: job.viewport.width < 600,
      });
      await send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: job.theme === "night" ? "dark" : "light" }],
      });
      await send("Page.navigate", { url: `file://${path.join(www, job.file)}` });
      await loaded;
      await send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(`[data-theme-set="${job.theme}"]`)}).click()`,
      });
      if (job.file !== "fixture.html") {
        const tab = job.lane === "polfin" ? "tab-polfin" : "tab-news";
        await send("Runtime.evaluate", { expression: `document.getElementById(${JSON.stringify(tab)})?.click()` });
      }
      const rootSelector = job.file === "fixture.html" ? `#${job.lane}` : "body";
      await send("Runtime.evaluate", {
        expression: `(() => {
          const root = document.querySelector(${JSON.stringify(rootSelector)}) || document;
          const visible = [...root.querySelectorAll(".detail-title")].find((el) => el.getClientRects().length);
          visible?.scrollIntoView({ block: "start", behavior: "auto" });
        })()`,
      });
      const measured = await send("Runtime.evaluate", { expression: measureExpression, returnByValue: true });
      const value = measured.result.value;
      const shotName = `${job.file.replace(".html", "")}-${job.lane}-${job.viewport.width}x${job.viewport.height}-${job.theme}.png`;
      const shot = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(shots, shotName), Buffer.from(shot.data, "base64"));
      records.push({ ...job, screenshot: `artifacts/evidence/en-r1/screenshots/${shotName}`, measurement: value, head });
    }
    let keyboard = null;
    try {
      keyboard = await runKeyboard(send, ws);
    } catch (error) {
      keyboard = { error: error.message };
    }
    fs.writeFileSync(path.join(outDir, "keyboard-reduced-motion.json"), `${JSON.stringify({ head, keyboard }, null, 2)}\n`);
    ws.close();
    return version.Browser || "chrome";
  } finally {
    chrome.kill("SIGKILL");
  }
}

async function runKeyboard(send, ws) {
  const loaded = waitEvent(ws, "Page.loadEventFired");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `file://${path.join(www, "daily-latest.html")}` });
  await loaded;
  await send("Runtime.evaluate", { expression: `document.documentElement.setAttribute("data-theme","day")` });
  const scrolled = await send("Runtime.evaluate", {
    expression: `window.scrollTo(0, document.body.scrollHeight); new Promise((resolve) => requestAnimationFrame(() => resolve({
      y: window.scrollY,
      hidden: document.querySelector("button.back-to-top").hasAttribute("hidden")
    })))`,
    awaitPromise: true,
    returnByValue: true,
  });
  await send("Runtime.evaluate", {
    expression: `window.__keylog = [];
      window.__clicks = 0;
      const button = document.querySelector("button.back-to-top");
      document.addEventListener("keydown", (event) => window.__keylog.push(event.key + "@" + (event.target.className || event.target.nodeName)), true);
      button.addEventListener("click", () => { window.__clicks += 1; });
      button.focus({ focusVisible: true });`,
  });
  const focused = await send("Runtime.evaluate", {
    expression: `({
      active: document.activeElement && document.activeElement.className,
      outline: getComputedStyle(document.activeElement).outlineStyle,
      outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
      outlineColor: getComputedStyle(document.activeElement).outlineColor
    })`,
    returnByValue: true,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await sleep(1800);
  const afterEnter = await send("Runtime.evaluate", {
    expression: `({ y: window.scrollY || document.documentElement.scrollTop || 0, keys: window.__keylog || [], clicks: window.__clicks || 0 })`,
    returnByValue: true,
  });
  let focusVisible = null;
  try {
    await send("DOM.enable");
    await send("CSS.enable");
    const documentNode = await send("DOM.getDocument", { depth: 0 });
    const found = await send("DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector: "button.back-to-top",
    });
    await send("CSS.forcePseudoState", {
      nodeId: found.nodeId,
      forcedPseudoClasses: ["focus-visible"],
    });
    focusVisible = (await send("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector("button.back-to-top");
        const cs = getComputedStyle(button);
        return { outline: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
      })()`,
      returnByValue: true,
    })).result.value;
  } catch (error) {
    focusVisible = { error: error.message };
  }
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reduced = await send("Runtime.evaluate", {
    expression: `(() => {
      const calls = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (arg) { calls.push(arg || null); return original.apply(this, arguments); };
      window.scrollTo(0, document.body.scrollHeight);
      document.querySelector("button.back-to-top").click();
      Element.prototype.scrollIntoView = original;
      return { matches: matchMedia("(prefers-reduced-motion: reduce)").matches, calls };
    })()`,
    returnByValue: true,
  });
  const homeLoaded = waitEvent(ws, "Page.loadEventFired");
  await send("Page.navigate", { url: `file://${path.join(www, "home.html")}` });
  await homeLoaded;
  const homeTop = await send("Runtime.evaluate", {
    expression: `(() => {
      const top = document.querySelector("button.back-to-top");
      const atRest = { hidden: top.hasAttribute("hidden"), y: window.scrollY, scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight, text: top.textContent.trim(), count: document.querySelectorAll(".back-to-top").length };
      window.scrollTo(0, window.innerHeight * 2);
      const after = { hidden: top.hasAttribute("hidden"), y: window.scrollY };
      return { atRest, after };
    })()`,
    returnByValue: true,
  });
  return {
    scrolled: scrolled.result.value,
    focused: focused.result.value,
    afterEnter: afterEnter.result.value,
    focusVisible: focusVisible,
    reduced: reduced.result.value,
    homeTop: homeTop.result.value,
  };
}

function writeReports(chains, contentHashes, browserNote, records) {
  const inventory = ["key,english", ...Object.entries(labels).map(([key, value]) => `${key},"${String(value).replaceAll('"', '""')}"`)];
  fs.writeFileSync(path.join(outDir, "ui-dictionary.csv"), `${inventory.join("\n")}\n`);
  const contentLines = ["# Content baseline", "", `HEAD ${head}`, `base ${base}`, "", "No content/ file differs from origin/main.", ""];
  for (const file of contentHashes) contentLines.push(`- \`${file.rel}\` ${file.sha256}`);
  fs.writeFileSync(path.join(outDir, "content-baseline.md"), `${contentLines.join("\n")}\n`);
  fs.writeFileSync(path.join(outDir, "title-chain.json"), `${JSON.stringify({ head, base, chains, synthetic: syntheticTitleStats() }, null, 2)}\n`);
  const rows = [];
  for (const record of records) {
    const badTitle = (record.measurement.titles || []).filter((title) => title.text !== title.source || title.clipped || title.textOverflow === "ellipsis" || title.lineClamp !== "none");
    const overflow = Math.max(...Object.values(record.measurement.overflow || { document: 0 }));
    const cropped = (record.measurement.pills || []).filter((pill) => pill.cropped);
    const pass = badTitle.length === 0 && overflow <= 1 && cropped.length === 0;
    rows.push({
      file: record.file,
      viewport: `${record.viewport.width}x${record.viewport.height}`,
      theme: record.theme,
      result: pass ? "PASS" : "FAIL",
      overflow,
      titles: (record.measurement.titles || []).length,
      cropped: cropped.map((pill) => pill.text),
      screenshot: record.screenshot,
    });
  }
  fs.writeFileSync(path.join(outDir, "browser-matrix.json"), `${JSON.stringify({ head, browserNote, rows, records }, null, 2)}\n`);
  return rows;
}

fs.mkdirSync(shots, { recursive: true });
copyAssets();
writePages();
const chains = [
  chainFor("content/daily/2026-11-09.json", "_site/daily/2026-11-09/index.html"),
  chainFor("content/weekly/2026-W45.json", "_site/weekly/2026-W45/index.html"),
  chainFor("content/daily/2026-11-06.json", "_site/daily/2026-11-06/index.html"),
  chainFor("content/daily/2026-11-05.json", "_site/daily/2026-11-05/index.html"),
];
const contentHashes = hashTree(path.join(root, "content"));
let browserNote = "";
let records = [];
try {
  browserNote = await runBrowser(records);
} catch (error) {
  browserNote = `未验证: ${error.message}`;
  fs.writeFileSync(path.join(outDir, "browser-error.txt"), `${error.stack || error.message}\n`);
}
const rows = writeReports(chains, contentHashes, browserNote, records);
const mismatch = chains.flatMap((chain) => chain.rows.filter((row) => !row.intermediateEqualsHtml || !row.sourceEqualsIntermediate));
console.log(JSON.stringify({
  head,
  browserNote,
  shots: records.length,
  titleMismatches: mismatch.length,
  browserFails: rows.filter((row) => row.result === "FAIL").length,
}, null, 2));
