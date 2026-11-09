# EN-brf report

Scope is this briefings repository only. No merge and no deploy.

## Brief versions

| Version | SHA256 | What it governs here |
| --- | --- | --- |
| Original attached brief | `6a95006c3cdc69965d0c7e001f729d1e6707721fa6535ca0ba91ef4ffdc65555` | Full titles, Top, English UI, Cairn tokens |
| EN-R1 supplement §11 | `ba58c55062256ae603ac150779adeb55442b399a4d9c8460d5223d8540514f96` | Keep existing `Color theme`. Visible Auto / Day / Night are the accessible names. Do not add long theme aria-labels. |

`artifacts/evidence/pre-en-r1/` was produced against the original brief only, before §11 was applied. It is not evidence for the supplement hash.

`artifacts/evidence/en-r1/` was produced after the §11 edit. JSON `head` in both sets is `9e2c9fdeaca013f32a59ea58e34ce3d8f132cdd0`, the branch base at capture. The delivering commit is the commit that adds this report. That git SHA is not either brief hash.

## Title chain

Detail titles in News and Politics & Finance were clipped in the template by `.cell-short.is-title` (`white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, `max-width: 32ch`). `displayTitle` does not slice the title. JSON `title` fields for 2026-11-09 and 2026-W45 contain no ellipsis and have no longer sibling field. 2026-11-09 has no markdown sibling. No characters were invented and `content/` was not modified.

After the change, detail cards use `.detail-title` (`white-space: normal`, `overflow-wrap: anywhere`, no line clamp). Table cells still use `.cell-short`. `artifacts/evidence/en-r1/title-chain.json` has zero mismatches: source title = `displayTitle` = HTML text for every detail card on 2026-11-09 (12), 2026-W45 (15), 2026-11-06 (20), and 2026-11-05 (8).

The synthetic title lives only in `test/fixtures/long-title.mjs` (≥60 CJK, ≥120 consecutive Latin, mixed punctuation). It is not in `content/`.

## EN-V1–V8

Evidence below is the EN-R1 capture unless noted. Viewport 1280×800 or 375×812. Theme is the clicked Day or Night control. Browser: Chrome/156.0.8078.47, `file://` pages, no preview server.

| ID | Status | Evidence |
| --- | --- | --- |
| EN-V1 | PASS | `en-r1/title-chain.json`; browser matrix 32/32 title text equals `data-detail-title`; no ellipsis or line-clamp |
| EN-V2 | PASS | `en-r1/screenshots/` for latest daily and weekly, News and Politics & Finance, both widths, day and night; fixture shots for all four labels. Long titles wrap (polfin card height 80 vs 38). |
| EN-V3 | PASS | `check-public.mjs` rejects CJK in buttons, `th`, `dt`, `h1`, `h2`, empty states, callout leads, `aria-label`, and `data-label`. `en-r1/ui-dictionary.csv`. Chinese remains on `lang="zh-Hans"` content. |
| EN-V4 | PASS | Visible `Top`; aria and title `Back to top`; one control. Enter on the focused button clicked and scrollY went 7340 → 0 (`en-r1/keyboard-reduced-motion.json`). Reduced motion called `scrollIntoView` with `behavior: auto`. Home stays hidden: max scrollY 580 &lt; 2×800. Visible box at 375 is 46×44 (`en-r1/top-hit-target.json`). `:focus-visible` computes `outline: 2px solid` when that pseudo-class is forced. |
| EN-V5 | PASS | Matrix overflow on document, body, and sheet is 0. Pill text rects stay inside the buttons. No font-size shrink. |
| EN-V6 | PASS | `git diff origin/main -- content` is empty. `en-r1/content-baseline.md`. Bodies, summaries, links, ids, and hashes were not rewritten. Detail titles were not lengthened; the full JSON title was already the source. |
| EN-V7 | PASS | Day accent `#2f5f9e`, night accent `#b54a4a`, white selected text. Night html background computed `rgb(10, 11, 12)`; night screenshots are dark and the selected Politics pill is red. Callout background stays `--surface-soft`. `--shadow-card` was not edited. Headless `getComputedStyle` on theme buttons after a same-document toggle disagreed with the pixels; the Night header screenshot shows the red Night pill. |
| EN-V8 | PASS for this package | This report plus `artifacts/evidence/INDEX.md`. Items not run in a browser are marked below, not treated as PASS. |

Runtime notes that are not PASS:

- Pre-EN-R1 screenshots are a separate, earlier run. They still show the long theme aria-labels and are not EN-R1 evidence.
- Home never reveals Top because the page cannot scroll two viewports. That is the existing short-page rule.
- Programmatic focus without `:focus-visible` correctly has no ring. The ring is specified on `button:focus-visible`.
- No GitHub Actions run was started. Deploy workflow triggers are `push` to `main`, `workflow_dispatch`, and schedule. Local `npm test` exit 0 is in `en-r1/npm-test.log`.

## EN-R1

Theme group `aria-label` remains `Color theme`. Auto, Day, and Night have no `aria-label`; `aria-pressed` is still updated by the existing click handler. Top was not changed by this clarification.

## Source gaps

None. No blocked content diff.

## AP overlap

No changes under `content/`, `lib/publish/`, `scripts/briefings-*`, `test/publish/`, `.github/`, or `package.json`.
