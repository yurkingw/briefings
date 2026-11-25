#!/bin/sh
# One observation. Stderr is discarded. The step always exits 0.
set +e
out=$(node scripts/briefings-pages-artifact-observe.mjs 2>/dev/null)
status=$?
if [ "$status" -ne 0 ] || [ -z "$out" ]; then
  printf '%s\n' '{"observe":"pages-artifact-list","list":"error","errorCode":"list_failed"}'
else
  printf '%s\n' "$out"
fi
exit 0
