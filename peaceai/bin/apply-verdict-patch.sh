#!/usr/bin/env bash
# M6: Builder-side apply of a PeaceAI verdict patch. Verifies, then `git am`. Never pushes.
# Usage: peaceai/bin/apply-verdict-patch.sh <issue> [--worktree <PeaceSTOCKS clone>] [--check]
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$here/node_modules/.bin/tsx" "$here/peaceai/bin/apply-verdict-patch.ts" "$@"
