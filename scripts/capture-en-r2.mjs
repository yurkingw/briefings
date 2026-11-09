import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { auditDetailTitles } from "./report-en-r2-titles.mjs";
import { assertStressTitle, renderStressPages } from "./render-stress-pages.mjs";
import { SYNTHETIC_LONG_TITLE } from "../test/fixtures/long-title.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join("/tmp", "en-r2"));
const www = path.join(outDir, "www");
const shots = path.join(outDir, "screenshots");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const base = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
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

const jobs = [];
for (const period of ["daily", "weekly"]) {
  for (const width of [375, 1280]) {
    jobs.push(
      { period, width, height: width === 375 ? 812 : 800, layout: "papers-hot", tab: "tab-papers", selector: "#papers-hot .hot-title.detail-title" },
      { period, width, height: width === 375 ? 812 : 800, layout: "papers-card", tab: "tab-papers", selector: "article.paper-card h3" },
      { period, width, height: width === 375 ? 812 : 800, layout: "github-row", tab: "tab-github", selector: "#gh-rising .brf-row-title" },
      { period, width, height: width === 375 ? 812 : 800, layout: "github-detail", tab: "tab-github", selector: "#gh-rising article.gh-detail h3" },
    );
  }
}

function preparePages() {
  const stats = assertStressTitle();
  fs.rmSync(www, { recursive: true, force: true });
  fs.mkdirSync(path.join(www, "css"), { recursive: true });
  fs.mkdirSync(path.join(www, "fonts"), { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.copyFileSync(path.join(root, "_site/css/site.css"), path.join(www, "css/site.css"));
  for (const name of fs.readdirSync(path.join(root, "_site/fonts"))) {
    fs.copyFileSync(path.join(root, "_site/fonts", name), path.join(www, "fonts", name));
  }
  const rendered = renderStressPages(www, root);
  for (const file of Object.values(rendered.pages)) {
    const html = fs.readFileSync(file, "utf8")
      .replaceAll('href="/css/site.css"', 'href="css/site.css"')
      .replaceAll('href="/briefings/css/site.css"', 'href="css/site.css"');
    if (html.includes("${chinese}") || html.includes("${latin}") || !html.includes(SYNTHETIC_LONG_TITLE)) {
      throw new Error(`refusing capture; ${file} fixture was not expanded`);
    }
    fs.writeFileSync(file, html);
  }
  return stats;
}

async function run() {
  const stats = preparePages();
  const report = auditDetailTitles(root);
  fs.writeFileSync(path.join(outDir, "en-r2-v1.json"), `${JSON.stringify({ head, base, ...report }, null, 2)}\n`);
  if (report.failures.length) throw new Error(`audit failed: ${report.failures.length}`);
  const contentDiff = execFileSync("git", ["diff", "--name-only", base, "HEAD", "--", "content"], { cwd: root, encoding: "utf8" }).trim();
  const port = 9341;
  const profile = path.join("/tmp", "en-r2-chrome");
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--disable-extensions",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--allow-file-access-from-files",
    ["--", "force-color-profile=srgb"].join(""),
  ], { stdio: "ignore" });
  const records = [];
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await get(`http://127.0.0.1:${port}/json/version`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (attempt === 39) throw new Error("chrome did not start");
      }
    }
    const list = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
    const page = list.find((item) => item.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const send = cdp(ws);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("brf-theme","day");` });
    for (const job of jobs) {
      const loaded = waitEvent(ws, "Page.loadEventFired");
      await send("Emulation.setDeviceMetricsOverride", {
        width: job.width,
        height: job.height,
        deviceScaleFactor: 1,
        mobile: job.width < 600,
      });
      await send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }],
      });
      await send("Page.navigate", { url: `file://${path.join(www, `stress-${job.period}.html`)}` });
      await loaded;
      const probe = `(() => {
          document.getElementById(${JSON.stringify(job.tab)}).click();
          const el = document.querySelector(${JSON.stringify(job.selector)});
          el.scrollIntoView({ block: "center", behavior: "auto" });
          const cs = getComputedStyle(el);
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()];
          const box = el.getBoundingClientRect();
          return {
            sample: (document.querySelector(".sample")?.textContent || "").trim(),
            theme: document.documentElement.getAttribute("data-theme"),
            text: el.textContent.replace(/\\s+/g, " ").trim(),
            whiteSpace: cs.whiteSpace,
            overflowWrap: cs.overflowWrap,
            textOverflow: cs.textOverflow,
            lineClamp: cs.webkitLineClamp || "none",
            lines: rects.length,
            width: box.width,
            height: box.height,
            x: box.x,
            y: box.y,
            scrollY: window.scrollY,
          };
        })()`;
      const measured = await send("Runtime.evaluate", { expression: probe, returnByValue: true });
      const value = measured.result.value;
      const name = `stress-${job.period}-${job.layout}-${job.width}.png`;
      const clipX = Math.max(0, Math.floor(value.x) - 8);
      const clipY = Math.max(0, Math.floor(value.scrollY + value.y) - 8);
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x: clipX,
          y: clipY,
          width: Math.max(1, Math.ceil(value.width) + 16),
          height: Math.max(1, Math.ceil(value.height) + 20),
          scale: 1,
        },
      });
      fs.writeFileSync(path.join(shots, name), Buffer.from(shot.data, "base64"));
      records.push({
        file: `screenshots/${name}`,
        period: job.period,
        layout: job.layout,
        width: job.width,
        height: job.height,
        theme: value.theme,
        selector: job.selector,
        sourceTitle: SYNTHETIC_LONG_TITLE,
        visibleIncludesSource: value.text.includes(SYNTHETIC_LONG_TITLE),
        sample: value.sample,
        whiteSpace: value.whiteSpace,
        overflowWrap: value.overflowWrap,
        textOverflow: value.textOverflow,
        lineClamp: value.lineClamp,
        lines: value.lines,
        box: { width: value.width, height: value.height },
      });
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
  }
  const bad = records.filter((record) => (
    record.theme !== "day"
    || record.sample !== "Sample"
    || !record.visibleIncludesSource
    || record.whiteSpace === "nowrap"
    || record.textOverflow === "ellipsis"
    || record.lineClamp !== "none"
    || record.lines < 2
  ));
  const index = {
    head,
    base,
    fixture: stats,
    contentDiff,
    theme: "day",
    records,
    bad,
    audit: report.counts,
  };
  fs.writeFileSync(path.join(outDir, "en-r2-v2-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  if (bad.length) {
    console.error(JSON.stringify(bad, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ head, shots: records.length, audit: report.counts, contentDiff }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
