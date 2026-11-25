#!/bin/sh
# One official listArtifacts() observation. Install and SDK text stay off the log.
# The step exits 0. deploy-pages is a later step and keeps its own result.
set +e
cd "$(dirname "$0")/.." || {
  printf '%s\n' '{"observe":"pages-artifact-list","list":"error","errorCode":"list_failed"}'
  exit 0
}
if ! npm ci --omit=dev --ignore-scripts --prefix tools/pages-artifact-observe >/dev/null 2>&1; then
  printf '%s\n' '{"observe":"pages-artifact-list","list":"error","errorCode":"install_failed"}'
  exit 0
fi
out=$(node scripts/briefings-pages-artifact-observe.mjs 2>/dev/null)
printf '%s\n' "$out" | node scripts/briefings-pages-artifact-observe-filter.mjs 2>/dev/null
if [ "$?" -ne 0 ]; then
  printf '%s\n' '{"observe":"pages-artifact-list","list":"error","errorCode":"list_failed"}'
fi
exit 0
