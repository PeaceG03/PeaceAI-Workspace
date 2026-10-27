#!/usr/bin/env bash
# LM retrain mode (workflow_dispatch input `mode`, a type: choice input passed to every step through the MODE env
# var, never expanded inside a run: script). Every script that reads a mode-dependent block of lm-retrain.json gets
# the mode from here: the fixed allowlist below is the only accepted set; anything else (unset, empty, other case,
# extra characters) is refused and nothing runs.
#   MODE=<mode> lm-retrain-mode.sh        prints the mode (finetune | pretrain), exit 0; else "unknown retrain mode: refused" on stderr, exit 1
set -euo pipefail
case "${MODE-}" in
  finetune|pretrain) printf '%s\n' "$MODE" ;;
  *) echo "unknown retrain mode: refused" >&2; exit 1 ;;
esac
