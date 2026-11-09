# EN-brf report

Evidence scope stays **PARTIAL**. This is not an acceptance PASS, and the PR is not merged.

## Heads

| Role | SHA |
| --- | --- |
| Measured implementation | `2625c3cde803c05e78c7ba0b33f240e12b48dd48` |
| This report, if committed alone | later than the measured tree, and only this file |

The downloadable archive is produced after the measurement and is not inside git.

## Wave display

Stored JSON is unchanged. The four existing wave values are mapped only at display time:

| Stored value | Display |
| --- | --- |
| 晨间 | Morning |
| 午间 | Afternoon |
| 午间+晨报补栏 | Afternoon + Morning supplement |
| §11改帽检阅重出·晨午同页 | Revised Morning/Afternoon edition |

An unknown Chinese wave value renders as `Recorded wave` and fails the build, so it cannot pass silently. The source string stays in JSON. Body text and titles are not rewritten. The home summary still contains the Chinese sentence `§11 改帽检阅重出…` because that is report content, not the wave field.

## EN-V

| ID | Status | Note |
| --- | --- | --- |
| EN-V1 | PARTIAL | Page-scoped titles match that page's JSON. Stress titles rendered by the daily and weekly templates are 65 CJK and 120 contiguous Latin. Pre-inbox source is 未验证. |
| EN-V2 | PARTIAL | 1280×800 and 375×812, effective day and night, separate lane shots. Not an aesthetic sign-off. |
| EN-V3 | PARTIAL | UI inventory is in the bundle. Generated wave/meta slots have no CJK. Chinese remains in `lang="zh-Hans"` content. |
| EN-V4 | PARTIAL | Daily and weekly, both widths: Tab, solid 2px ring, Enter and Space return to scrollY 0 under reduced motion. |
| EN-V5 | PARTIAL | Titled runs stay within 1px of horizontal overflow. |
| EN-V6 | PARTIAL | No title, body, or URL regression against `9e2c9fd`. 209 stored strings are absent from both renders. |
| EN-V7 | PARTIAL | Selected Day computes to `#2f5f9e` with `#ffffff` text. Selected Night computes to `#b54a4a` with `#ffffff` text. Callouts are `#f0f0f1` and `#1c1c1e`. Card shadows are not `none`. Recorded in `theme-fill.json` on this measured tree. Not a full visual audit. |
| EN-V8 | 未验证 | The bundle names `2625c3c`. It does not close acceptance. |

Afternoon detail cards on 2026-11-09 are 未验证: every item wave is 晨间, so those panels are empty. The JSON was not edited.
