#!/usr/bin/env bash
# The daily update, run by .github/workflows/update.yml on Dave's personal
# Claude and ChatGPT subscriptions. Every stage skips work already done, so a
# day with no new posts costs almost nothing, and a stage stopped by a usage
# limit or the deadline picks up the next day. It only adds: existing claims
# keep the date they were first checked against (scripts/lib/evaluation.ts).
#
#   bash scripts/ci/update.sh            the whole run
#   bash scripts/ci/update.sh --no-calls the store check, roll and discovery only (no model calls)
#
# Structural stages (store check, roll, corpus, sorting) must
# succeed, or the run stops before anything is committed. Model stages may
# stop early (a usage limit, the deadline): their finished work is kept and
# the rest waits for tomorrow. The deadline leaves the workflow time to save
# the login and the private store and to commit.
set -uo pipefail
cd "$(dirname "$0")/../.."
calls=1; [ "${1:-}" = "--no-calls" ] && calls=0
deadline=$(( SECONDS + ${PC_UPDATE_MINUTES:-270} * 60 ))
n() { node --no-warnings "$@"; }
must() { echo "::group::$*"; "$@"; local rc=$?; echo "::endgroup::"; if [ $rc -ne 0 ]; then echo "::error::$* failed (exit $rc); stopping before any commit"; exit $rc; fi; }
step() {
  # `timeout` runs a program, not a shell function: expand the n shorthand.
  if [ "$1" = n ]; then shift; set -- node --no-warnings "$@"; fi
  local left=$(( deadline - SECONDS ))
  if [ $left -le 60 ]; then echo "::warning::deadline reached; skipping $* (it continues tomorrow)"; return 0; fi
  echo "::group::$*"; local t=$SECONDS rc
  if command -v timeout >/dev/null; then timeout --signal=TERM --kill-after=60 "$left" "$@"; rc=$?; else "$@"; rc=$?; fi
  echo "::endgroup::"
  if [ $rc -eq 124 ]; then echo "::warning::$* stopped at the deadline after $((SECONDS - t))s (it continues tomorrow)";
  elif [ $rc -ne 0 ]; then echo "::warning::$* exited $rc after $((SECONDS - t))s"; else echo "$* done in $((SECONDS - t))s"; fi
  # Save after every model stage: the store, then the records. A failed save
  # stops the run, so nothing more is spent on work that could not be kept.
  local name; name=$(basename "${3:-$1}" .ts)
  bash scripts/ci/checkpoint.sh "$name" || { echo "::error::could not save after $name; stopping"; exit 1; }
  return 0
}

# Refuse a missing or partial private store: every extracted post in the
# ledger needs its extraction, readable, or the corpus rebuild would mark it
# pending and drop its claims from the ledger.
must n -e '
  const fs = require("node:fs");
  const dir = ".cache/private-sources/extractions";
  // No ledger yet means a new register with nothing extracted to protect.
  const ledger = "research/corpus/ledger.jsonl";
  const posts = (fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.kind === "post" && l.status === "extracted");
  const bad = posts.filter((p) => { try { return !Array.isArray(JSON.parse(fs.readFileSync(`${dir}/${p.id}.json`, "utf8")).claims); } catch { return true; } });
  console.log(`private store: ${posts.length - bad.length} of ${posts.length} extracted posts have a readable extraction`);
  if (bad.length) { console.error(`missing or unreadable: ${bad.slice(0, 10).map((p) => p.id).join(", ")}${bad.length > 10 ? ", ..." : ""}`); process.exit(1); }'

windows=$(n -e 'import("./src/config.ts").then((m) => console.log(m.CONFIG.subjects.flatMap((s) => s.windows).filter((w) => w.rolling).map((w) => w.id).join(" ")))') || { echo "::error::cannot read the config"; exit 1; }
[ -n "$windows" ] || { echo "::error::no rolling windows in the config"; exit 1; }

must n scripts/roll-windows.ts
# A failed discovery writes nothing (the window keeps yesterday's manifest), so
# it does not stop the run: pending work on earlier posts still goes ahead.
# A check run (--no-calls) is the setup test, so there a failed discovery
# fails the run, and nothing is saved.
if [ "$calls" = 0 ]; then
  for w in $windows; do must n scripts/discover.ts "$w"; done
  echo "no model calls (--no-calls)"; exit 0
fi
for w in $windows; do step n scripts/discover.ts "$w"; done

for w in $windows; do step n scripts/extract.ts --window "$w" --concurrency 3; done
must n scripts/corpus.ts
step n scripts/screen.ts --concurrency 6
must n scripts/screened.ts
step n scripts/fix.ts --concurrency 4
step n scripts/screen.ts --concurrency 6
must n scripts/screened.ts
step n scripts/grade.ts --claude 0 --codex 8 --batch 4
step n scripts/review-batch.ts --concurrency 6
step n scripts/revise.ts --concurrency 4
step n scripts/review-batch.ts --concurrency 6
step n scripts/probable.ts --concurrency 4
must n scripts/corpus.ts
must n scripts/screened.ts
