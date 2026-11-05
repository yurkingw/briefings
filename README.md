# Briefings

Public mirror of daily and weekly intelligence briefings.

https://yurkingw.github.io/briefings/

The in-chat Canvas (“今日情报” / “本周情报”) remains the authoritative reading surface. This site only mirrors briefing JSON that has been added to the repository.

The shell (navigation, section labels, empty states) is English. Briefing body text stays in its original language, usually zh-Hans.

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

1. Add JSON at `content/daily/YYYY-MM-DD.json` or `content/weekly/YYYY-Www.json` (`YYYY-Www` is the ISO week in Asia/Shanghai).
2. Optionally add a Markdown mirror with the same basename. The site renders JSON only. Markdown must not introduce fields the JSON does not have.
3. `schema` must be `qianji.briefing.daily.v1` or `qianji.briefing.weekly.v1`. The filename must match `date` or `week`.
4. Keep the public strip rules: no canvas ids, store or internal URLs, `/workspace` paths, routine folder ids, Home pagination or post counts, exact Home impression counts, or raw internal package names. Mark uncertain amounts `unconfirmed` instead of stating them as fact. `metrics.home_related` stays an `a/b` ratio.
5. Open a pull request. CI runs `npm test`.

`workflow_dispatch` does not fetch a private archive.

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
