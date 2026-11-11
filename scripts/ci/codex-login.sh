#!/usr/bin/env bash
# The robot's ChatGPT login (Dave's personal ChatGPT, its own device login),
# kept in private Cloudflare R2 storage, never in git or a repo secret.
#
#   scripts/ci/codex-login.sh fetch <name>   download it to $RUNNER_TEMP/codex-<name>/auth.json,
#                                             and export CODEX_HOME + CODEX_LOGIN_WRITEBACK=1
#   scripts/ci/codex-login.sh save <name>    upload it again if a run refreshed it
#
# Needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ENDPOINT in this step's
# environment only. They are never written to $GITHUB_ENV or to disk, so the
# model's process never sees them. The login refreshes about every ten days and
# the old refresh token dies once used, so every run that may refresh it must
# save it back, and runs that share a login must not overlap (each workflow
# job that uses it sits in one concurrency group).
#
# If a login is ever lost (a runner died between a refresh and the save), the
# fix is a new device login: CODEX_HOME=<empty dir> codex login --device-auth,
# Dave approves it with his personal ChatGPT, then upload its auth.json to
# logins/<name>/auth.json.
set -euo pipefail
mode="${1:?fetch or save}"; name="${2:?login name}"
dir="${RUNNER_TEMP:-/tmp}/codex-${name}"
key="s3://robots-private/logins/${name}/auth.json"
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?}" AWS_DEFAULT_REGION=auto
# Retry hard: a refreshed login that fails to upload is lost with the runner.
export AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=10
s3() { aws s3 "$@" --endpoint-url "${R2_ENDPOINT:?}" --only-show-errors; }
case "$mode" in
  fetch)
    mkdir -p "$dir" && chmod 700 "$dir"
    s3 cp "$key" "$dir/auth.json"
    chmod 600 "$dir/auth.json"
    sha256sum "$dir/auth.json" | cut -d' ' -f1 > "$dir/.fetched"
    python3 -c 'import json,sys; t=json.load(open(sys.argv[1])).get("tokens") or {}; sys.exit(0 if t.get("refresh_token") else "the stored login has no refresh token")' "$dir/auth.json"
    { echo "CODEX_HOME=$dir"; echo "CODEX_LOGIN_WRITEBACK=1"; } >> "${GITHUB_ENV:-/dev/null}"
    echo "login ${name} fetched"
    ;;
  save)
    [ -f "$dir/auth.json" ] || { echo "no login to save"; exit 0; }
    now=$(sha256sum "$dir/auth.json" | cut -d' ' -f1)
    if [ "$now" = "$(cat "$dir/.fetched" 2>/dev/null)" ]; then echo "login ${name} unchanged"; exit 0; fi
    python3 -c 'import json,sys; t=json.load(open(sys.argv[1])).get("tokens") or {}; sys.exit(0 if t.get("refresh_token") else "refusing to save a login with no refresh token")' "$dir/auth.json"
    s3 cp "$dir/auth.json" "$key"
    echo "login ${name} refreshed and saved"
    ;;
  *) echo "unknown mode $mode" >&2; exit 2 ;;
esac
