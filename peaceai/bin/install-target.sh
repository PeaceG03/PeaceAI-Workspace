#!/usr/bin/env bash
# M5: installs a target's locked dependencies without lifecycle scripts. Usage: install-target.sh <dir> <npm|pnpm>.
set -euo pipefail
dir="$1"; kind="$2"
cd "$dir"
case "$kind" in
  npm) npm ci --ignore-scripts --no-audit --no-fund --loglevel=error ;;
  pnpm) COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --ignore-scripts --reporter=silent ;;
  *) echo "unknown installer" >&2; exit 1 ;;
esac
echo "target dependencies installed"
