# Export delta · optional `polfin` block

Schema stays `qianji.briefing.daily.v1` / `qianji.briefing.weekly.v1`. `polfin` is optional.

## metrics

- `metrics.polfin`: count of rows in this column.
- Daily may also carry `metrics.polfin_morning`, `metrics.polfin_noon`, `metrics.polfin_detail`. They are display counts, not a second list.

## `polfin[]`

Each row is mutually exclusive with `news[]` (ids must not collide).

```json
{
  "id": "pf-YYYYMMDD-NN",
  "wave": "晨间",
  "angle": "sanctions|regulation|election|industrial_policy|geo_finance|other",
  "title": "",
  "background": "",
  "facts": "",
  "why": "",
  "arch_impact": null,
  "channel": "",
  "first_source_at": "",
  "links": [{ "label": "", "url": "https://..." }],
  "hard_gate": false,
  "detail": true
}
```

`wave` is required for a daily row (`晨间` or `午间`). Weekly rows may omit it. `links` may be URL strings or `{label, url}`. A label longer than 12 characters is clipped in tables. The public page shows one link plus `+N` in tables, and the full set on the detail card.
