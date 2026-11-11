#!/usr/bin/env bash
# Save what the daily update has done so far: the private store first (as the
# bundle), then the public records (validated, committed, pushed). Run after
# every model stage, so a failure or a cancelled run loses at most the stage
# it was in (the first full run lost 2.5 hours by saving only at the end).
# The store goes first so git never points at private files that were not
# saved. Checkpoint commits skip the Cloudflare build; the release at the end
# is what changes the site. Exits non-zero if either save fails.
set -euo pipefail
cd "$(dirname "$0")/../.."
label="${1:-checkpoint}"
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?}" AWS_DEFAULT_REGION=auto
export AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=10
count_file="${RUNNER_TEMP:-/tmp}/ps-count"
[ -f "$count_file" ] || { echo "::error::the store was never fetched; not saving"; exit 1; }
now=$(find .cache/private-sources -type f | wc -l | tr -d ' ')
if [ "$now" -lt "$(cat "$count_file")" ]; then echo "::error::the store shrank ($(cat "$count_file") -> $now files); not saving"; exit 1; fi
bundle="${RUNNER_TEMP:-/tmp}/ps-checkpoint.tar.zst"
tar -C .cache -cf - private-sources | zstd -T0 -3 -q -f -o "$bundle"
# R2 sometimes rejects the last step of a multipart upload (InvalidPart,
# 2026-11-10: the run stopped at its first save). A fresh upload works, so try
# three times.
saved=0
for i in 1 2 3; do
  if aws s3 cp "$bundle" s3://robots-private/pundit/private-sources.tar.zst --endpoint-url "${R2_ENDPOINT:?}" --only-show-errors; then saved=1; break; fi
  echo "::warning::store upload failed (try $i of 3)"; sleep $((i * 20))
done
[ "$saved" = 1 ] || { echo "::error::could not upload the store after $label"; exit 1; }
echo "$now" > "$count_file"
rm -f "$bundle"
echo "store saved after $label: $now files"
npm run -s validate >/dev/null
git add -A data research config
if git diff --cached --quiet; then echo "no record changes after $label"; exit 0; fi
git -c user.name="punditclaims update" -c user.email="update@punditclaims.ai" commit -q -m "Daily update $(date -u +%F): after $label [CF-Pages-Skip]"
for i in 1 2 3; do git push -q origin HEAD:main && { echo "records pushed after $label"; exit 0; }; git pull -q --rebase origin main; done
echo "::error::could not push the records after $label"; exit 1
