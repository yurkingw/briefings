# Briefings

Public mirror of daily and weekly intelligence briefings.

https://yurkingw.github.io/briefings/

The in-chat Canvas (“今日情报” / “本周情报”) remains the authoritative reading surface. This site only mirrors briefing JSON that has been added to the repository.

The shell (Home, Daily, Weekly, theme, empty states) is English. Daily and weekly column labels follow the Pages segmented names in Chinese (要闻 / 顶尖论文 / GitHub / 附录, and 金融决策 on weekly). Briefing body text stays in its original language, usually zh-Hans.

## Build

Requires Node.js 22 (18+ works).

```bash
npm ci
npm run build
```

`npm run build` writes `_site/` and fails if public HTML or `content/` still contains stripped internal text (canvas ids, `/workspace` paths, store URLs, routine folder ids, Home page counts, exact impression counts, raw internal package names).

Eleventy writes pages at the artifact root (`_site/index.html`, `_site/daily/...`). `pathPrefix` rewrites links to `/briefings/...`. GitHub Pages for this repository already serves that artifact at `https://yurkingw.github.io/briefings/`, so the workflow uploads `_site` and does not nest another `briefings/` directory.

`npm test` runs the same build check.

## Local preview

`pathPrefix` is `/briefings/`. The dev server serves the site under that prefix, matching GitHub project Pages.

```bash
npm ci
npm run serve
```

Open http://localhost:8080/briefings/

Home, daily, and weekly links are root-absolute (`/briefings/...`). Canonical URLs use `https://yurkingw.github.io/briefings`.

## Add a briefing

This repository does not receive pushes from 千机阁. Add a briefing with a pull request, or run **Deploy GitHub Pages** → **Run workflow** only to rebuild what is already on the selected branch.

1. Add JSON at `content/daily/YYYY-MM-DD.json` or `content/weekly/YYYY-Www.json` (`YYYY-Www` is the ISO week in Asia/Shanghai). For a daily file, `node scripts/ingest-daily.mjs path/to/YYYY-MM-DD.json` writes that JSON and a Markdown mirror. It keeps the `2026-11-05` shape: `{label,url}` links become URL strings, internal fields are stripped, and amounts the source itself calls 量级 / 叙事 / 回顾 are marked `unconfirmed`. It does not fill missing slogans, licenses, waves, or star counts.
2. Optionally add a Markdown mirror with the same basename. The site renders JSON only. Markdown must not introduce fields the JSON does not have. The ingest script writes this mirror.
3. `schema` must be `qianji.briefing.daily.v1` or `qianji.briefing.weekly.v1`. The filename must match `date` or `week`.
4. Keep the public strip rules: no canvas ids, store or internal URLs, `/workspace` paths, routine folder ids, Home pagination or post counts, exact Home impression counts, or raw internal package names. Mark uncertain amounts `unconfirmed` instead of stating them as fact. `metrics.home_related` stays an `a/b` ratio.
5. Open a pull request. CI runs `npm test`.

Same-day update: `node scripts/ingest-daily.mjs path/to/YYYY-MM-DD.json` overwrites `content/daily/YYYY-MM-DD.json` and `.md`. Then open one pull request. No extra service or workflow.

`workflow_dispatch` does not fetch a private archive.

## Offline publish contract

`node scripts/briefings-publish.mjs --ready <ready.json> --receipt-dir <dir>` validates a local ready file and does not upload it. Production upload is `node scripts/briefings-upload.mjs --ready <ready.json> --receipt-dir <dir>`, which sends a public envelope only when `BRIEFINGS_PUBLISH_TOKEN` is set. Without that variable it exits 50 and does not call GitHub. The token is not an Actions secret. `.github/workflows/pages.yml` processes `_inbox/` in the same run. See `docs/briefings-publish.md` and `docs/briefings-publish-e2e.md`. The export → inbox → Actions → public page path has not been executed.

## GitHub Pages

Pages is deployed with GitHub Actions, not “Deploy from a branch”.

Workflow: `.github/workflows/pages.yml` (push to `main`, and `workflow_dispatch`).

If the site is not live yet, enable Actions as the Pages source:

1. Merge this workflow to `main`.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Save. The **Deploy GitHub Pages** workflow should run and publish `https://yurkingw.github.io/briefings/`.

If Source is still “Deploy from a branch”, or Pages is off, switch it to GitHub Actions. The workflow file has to be on `main` before that source can succeed.

After a green deploy, these paths should return 200:

- https://yurkingw.github.io/briefings/
- https://yurkingw.github.io/briefings/daily/2026-11-05/
- https://yurkingw.github.io/briefings/weekly/2026-W45/
