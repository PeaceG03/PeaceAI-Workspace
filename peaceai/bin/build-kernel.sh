#!/usr/bin/env bash
# Bundles only the native synthesis entry point (plus its imports) from a core checkout.
# Usage: build-kernel.sh <core-dir> <out-file.cjs>. Output must live outside the workspace.
set -euo pipefail
core="$1"
out="$2"
here="$(cd "$(dirname "$0")/../.." && pwd)"
case "$out" in "$here"/*) echo "build-kernel: output must be outside the workspace" >&2; exit 1 ;; esac
NODE_PATH="$here/node_modules" "$here/node_modules/.bin/esbuild" \
  "$core/packages/coding-kernel/src/NativeCodeSynthesis.ts" \
  --bundle --platform=node --format=cjs --target=node20 \
  --log-level=error --outfile="$out"
echo "kernel bundle built"
