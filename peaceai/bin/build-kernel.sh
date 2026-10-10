#!/usr/bin/env bash
# Bundles only the Actions kernel entry point (plus its imports) from a core checkout: the native
# synthesizer, the edit families and the multi-step planner (M6). The kernel guard then proves the
# bundle reaches no teacher or outside-model module, endpoint or identifier; a violation fails the build.
# Usage: build-kernel.sh <core-dir> <out-file.cjs>. Output must live outside the workspace.
set -euo pipefail
core="$1"
out="$2"
here="$(cd "$(dirname "$0")/../.." && pwd)"
case "$out" in "$here"/*) echo "build-kernel: output must be outside the workspace" >&2; exit 1 ;; esac
entry="$core/packages/coding-kernel/src/ActionsKernel.ts"
if [ ! -f "$entry" ]; then echo "build-kernel: core has no Actions kernel entry" >&2; exit 1; fi
meta="$(mktemp "${TMPDIR:-/tmp}/peaceai-kernel-meta.XXXXXX")"
trap 'rm -f "$meta"' EXIT
NODE_PATH="$here/node_modules" "$here/node_modules/.bin/esbuild" \
  "$entry" \
  --bundle --platform=node --format=cjs --target=node20 \
  --log-level=error --metafile="$meta" --outfile="$out"
if ! "$here/node_modules/.bin/tsx" "$here/peaceai/bin/kernel-guard.ts" "$out" "$meta"; then
  rm -f "$out"
  exit 1
fi
echo "kernel bundle built"
