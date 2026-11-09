# EN-brf report

Do not read EN-V8 as PASS. The files previously committed under `artifacts/evidence/` were captured while `git HEAD` was still `9e2c9fdeaca013f32a59ea58e34ce3d8f132cdd0`. They are not bound to the implementation commit.

The re-run lives outside the repository so a later report commit does not pretend to be the tested tree:

`/opt/cursor/artifacts/en-brf-2335d20/`

Tested implementation: `ef1f2019d1ea790a098ae4b1a70d3f14eb0312a6`

That commit's working tree was clean. File hashes are in `/opt/cursor/artifacts/en-brf-2335d20/manifest.json`. This report is a later commit. It does not change the implementation that was measured.

## Brief hashes

| Version | SHA256 |
| --- | --- |
| Original | `6a95006c3cdc69965d0c7e001f729d1e6707721fa6535ca0ba91ef4ffdc65555` |
| EN-R1 §11 | `ba58c55062256ae603ac150779adeb55442b399a4d9c8460d5223d8540514f96` |

## Upstream titles

In this repository, the earliest 2026-11-09 payload is `_inbox/daily/2026-11-09.json` at `aca2271`. Its 15 news and Politics & Finance titles match `content/daily/2026-11-09.json`. Later inbox envelopes match as well. `stripValue` does not change those strings. `displayTitle` does not drop characters from them.

Anything before that inbox envelope is not in this repository. That part is **未验证**. Matching JSON fields and the absence of an ellipsis do not prove the title was complete when it was written.

## Rendered content

Before HTML is the parent tree `9e2c9fd`. After HTML is `ef1f201`. Comparison: `/opt/cursor/artifacts/en-brf-2335d20/semantic-diff.json`.

- Detail-title text is unchanged.
- Card body text is unchanged after the decision-list separators were put back.
- No `http` href present before is missing after.
- The only body token treated as a UI label is the generated link word `链接` → `Link`.
- 209 stored strings are absent from both renders. They were already omitted by the previous template, mostly GitHub rows past the existing cap. This PR did not remove them, and their absence is not evidence about an upstream title.

## EN-V

| ID | Status | Where |
| --- | --- | --- |
| EN-V1 | Partial | Visible `.detail-title` text matches the page's own JSON title. Four news runs in `manifest.json` were first scored against the wrong daily because ids collided; `title-recheck.json` shows those 8 strings match `content/daily/2026-11-09.json`. Pre-inbox completeness is 未验证. |
| EN-V2 | PASS for the captured pages | Screenshots under `/opt/cursor/artifacts/en-brf-2335d20/screenshots/`. Styles on those runs have normal wrapping and no line clamp. |
| EN-V3 | PASS | `npm test` exit 0, log `/opt/cursor/artifacts/en-brf-2335d20/npm-test.log`. |
| EN-V4 | PASS for Tab, Enter, and Space on the daily page | Tab reached `button.back-to-top` in 41 steps with `outline: solid 2px`. Enter and Space each recorded one click and `scrollY` 0. Logs: `keyboard.json`, `keyboard-activation.json`. Home still hides Top because it cannot scroll two viewports. |
| EN-V5 | PASS for the same runs | Overflow 0. Pill text rects were inside the buttons. |
| EN-V6 | PASS for rendered fields that both templates show | See the semantic diff. Not a claim that every stored string is on the page. |
| EN-V7 | PASS after sampling the pill fill | Computed Day is `rgb(47, 95, 158)` and Night is `rgb(181, 74, 74)`, both with white text. Page backgrounds match `#ebe9e6` and `#0a0b0c`. The glyph center is mixed; the fill pixels match the computed color. `theme-fill.json`. |
| EN-V8 | 未验证 | The outside bundle is the HEAD-bound capture for `ef1f201`. It is not an acceptance sign-off. |

No content, publish, workflow, or manifest files are changed. No deploy. Visual acceptance by 玉宸墟 is still open.
