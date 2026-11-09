# Evidence index

Two captures. Do not treat the earlier one as bound to the EN-R1 document hash.

| Set | Brief | Path |
| --- | --- | --- |
| Before §11 | original `6a95006c3cdc69965d0c7e001f729d1e6707721fa6535ca0ba91ef4ffdc65555` only | `artifacts/evidence/pre-en-r1/` |
| After §11 | original brief plus EN-R1 `ba58c55062256ae603ac150779adeb55442b399a4d9c8460d5223d8540514f96` | `artifacts/evidence/en-r1/` |

## pre-en-r1

Captured while theme buttons still had long `aria-label`s (`Auto, follow system theme` and the Day/Night equivalents). Binding note: `artifacts/evidence/pre-en-r1/BINDING.md`.

- `title-chain.json`
- `browser-matrix.json`
- `keyboard-reduced-motion.json`
- `content-baseline.md`
- `ui-dictionary.csv`
- `screenshots/` (32 PNG; theme accessible names are the pre-EN-R1 ones)

## en-r1

Captured after restoring `Color theme` and removing those long labels. Binding note: `artifacts/evidence/en-r1/BINDING.md`.

- `title-chain.json` — source / displayTitle / HTML for daily 2026-11-09, weekly 2026-W45, daily 2026-11-06, daily 2026-11-05
- `browser-matrix.json` — 32 runs, all PASS on title equality, no ellipsis, overflow ≤ 1px, pill text inside the button box
- `keyboard-reduced-motion.json` — Enter reached scrollY 0; reduced motion used `behavior: auto`
- `top-hit-target.json` — visible Top box 46×44 at 375×812
- `screenshots/` — daily and weekly × News and Politics & Finance × 1280×800 and 375×812 × day and night, plus the synthetic fixture in all four lane labels
- `npm-test.log` — `npm test` exit 0 (publish tests 63, then eleventy public check)
- `content-baseline.md` — content file hashes; no content diff from `origin/main`
- `ui-dictionary.csv`

Report: `artifacts/REPORT.md`.
