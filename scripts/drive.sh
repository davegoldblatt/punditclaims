#!/bin/zsh
# zsh scripts/drive.sh — keeps every stage of the corpus pipeline moving until
# stopped. Every 15 minutes it records new extractions, classifies screened
# claims, and restarts any stage that has finished. Each stage skips work that
# is already done, so restarting is always safe. Logs go to .runs/.
# Claude drafts nothing: its 5-hour limit is kept for reviews, which need both
# providers (docs/running-a-corpus.md).
cd "${0:A:h}/.."
mkdir -p .runs
run() { pgrep -f "scripts/$1.ts" >/dev/null || (nohup node --no-warnings scripts/$1.ts ${@:2} >> .runs/$1-drive.log 2>&1 &) }
while true; do
  echo "== $(date -u +%FT%TZ)" >> .runs/drive.log
  node --no-warnings scripts/corpus.ts >> .runs/drive.log 2>&1
  node --no-warnings scripts/screened.ts >> .runs/drive.log 2>&1
  run screen --concurrency 24
  run fix --concurrency 4
  run grade --claude 0 --codex 24 --batch 4
  run review-batch --concurrency 12
  run revise --concurrency 6
  sleep 900
done
