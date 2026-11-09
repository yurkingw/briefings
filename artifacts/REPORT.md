# EN-brf report

Evidence scope stays **PARTIAL**. This is not an acceptance PASS, and the PR is not merged.

## Heads

| Role | SHA | What it is |
| --- | --- | --- |
| Previous measured tree | `ef1f2019d1ea790a098ae4b1a70d3f14eb0312a6` | Earlier capture. Its long fixture was the unexpanded source text. Not current. |
| Previous report-only commit | `39d8fe1b0b2ac6c7d03560e3c427fc3bffa78a60` | Only `artifacts/REPORT.md`. CI: https://github.com/yurkingw/briefings/actions/runs/42560699009 |
| Implementation tested by the new bundle | `884226bcc41de4d1473d576d0628bcf7a6cb5a73` | Wave display labels, real stress title, template render, CI guards. |
| This report | the commit that adds this file | Report only if the diff is `artifacts/REPORT.md`. It is not the measured tree. |

New bundle, outside git: `/opt/cursor/artifacts/en-brf-884226b/`

Old bundle, not current: `/opt/cursor/artifacts/en-brf-2335d20.tar.gz`

## What changed in the implementation

Stored JSON is unchanged. `displayWave` maps only `晨间` → Morning, `午间` → Afternoon, and `午间+晨报补栏` → Afternoon + Morning supplement. The 2026-11-06 page wave `§11改帽检阅重出·晨午同页` is not in that map, so the home row still shows it.

The stress title is built by concatenation and rendered through `briefing.njk` / `base.njk` for a daily page and a weekly page. It is not written to `content/` or `_site`.

## EN-V

| ID | Status | Note |
| --- | --- | --- |
| EN-V1 | PARTIAL | Visible detail titles on the real pages match that page's JSON, with ids scoped per file. Stress titles in the rendered daily and weekly HTML are 65 CJK and 120 contiguous Latin. Pre-inbox source is 未验证. |
| EN-V2 | PARTIAL | Screenshots exist for 1280×800 and 375×812, effective day and night. Stress lanes are separate shots and their hashes differ. This is not an aesthetic sign-off. |
| EN-V3 | PARTIAL | `ui-inventory.csv`, `ui-inventory.md`, and `content-whitelist.csv` are in the bundle. Mapped wave meta is English. The unmapped 2026-11-06 wave string is still Chinese. |
| EN-V4 | PARTIAL | Daily and weekly, 1280 and 375: Tab reaches Top with `outline: solid 2px`; Enter and Space each click and return to scrollY 0 under reduced motion. See `keyboard.json`. Home hide is still the two-viewport rule. |
| EN-V5 | PARTIAL | Measured overflow on the titled runs is within 1px. Not independently remeasured outside this capture. |
| EN-V6 | PARTIAL | `semantic-diff.json`: no title, body, or URL regressions against `9e2c9fd`. 209 stored strings are absent from both renders. Wave display changes are UI-only. |
| EN-V7 | PARTIAL | Day selected fill `rgb(47, 95, 158)`, night `rgb(181, 74, 74)`, white text. Day callout `rgb(240, 240, 241)`, night callout `rgb(28, 28, 30)`. Card shadow is the Cairn `--shadow-card`, not `none`. Not a full visual audit. |
| EN-V8 | 未验证 | The new bundle names tested HEAD `884226b`. It does not close acceptance. |

Afternoon detail titles on 2026-11-09 are **未验证 / NOT APPLICABLE**. Every news and polfin `wave` in that file is `晨间`, so the afternoon panels have no detail cards. The JSON was not edited. See `afternoon-investigation.json`.

No content, publish, workflow, or manifest files are in the implementation diff. No deploy.
