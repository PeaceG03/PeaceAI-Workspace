#!/usr/bin/env bash
# M5: installs a target's locked dependencies without lifecycle scripts. Usage: install-target.sh <dir> <npm|pnpm>.
# Retry: the package-manager download (corepack fetching the pnpm binary from registry.npmjs.org) can time out on a
# runner (30s). The install is retried up to 3 times with backoff (15s, 45s). Each attempt runs the same pinned,
# lockfile-frozen, script-free command; a partial node_modules is removed first so no attempt reuses a half-written tree.
set -euo pipefail
dir="${1:-}"; kind="${2:-}"
# M94: an empty or missing <dir> would make `cd ""` a no-op and the retry's `rm -rf node_modules` run in the caller's cwd.
[ -n "$dir" ] || { echo "missing target dir" >&2; exit 1; }
cd "$dir"
case "$kind" in
  npm|pnpm) ;;
  *) echo "unknown installer" >&2; exit 1 ;;
esac
install_once() {
  case "$kind" in
    npm) npm ci --ignore-scripts --no-audit --no-fund --loglevel=error ;;
    pnpm) COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --ignore-scripts --reporter=silent ;;
  esac
}
attempts=3
delays=(15 45)
# Tests only: PEACEAI_INSTALL_NO_BACKOFF=1 skips the sleeps (the attempt count and commands are unchanged).
n=1
until install_once; do
  if [ "$n" -ge "$attempts" ]; then echo "target dependency install failed after $n attempts" >&2; exit 1; fi
  wait_s="${delays[$((n - 1))]}"
  echo "target dependency install attempt $n failed; retrying in ${wait_s}s" >&2
  [ "${PEACEAI_INSTALL_NO_BACKOFF:-}" = "1" ] || sleep "$wait_s"
  rm -rf node_modules
  n=$((n + 1))
done
echo "target dependencies installed"
