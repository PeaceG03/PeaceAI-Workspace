#!/usr/bin/env bash
# LM retrain dry run (workflow_dispatch input dry_run): every Results write in peace-lm-retrain.yml runs through this.
#   DRY_RUN=false lm-retrain-dryrun-guard.sh <command...>   runs the command (exec)
#   anything else (DRY_RUN=true, unset, empty, other)       refuses: prints "dry run: Results write refused", exit 1,
#                                                           the command is never started (fail closed)
set -euo pipefail
if [ "${DRY_RUN-}" != false ]; then echo "dry run: Results write refused"; exit 1; fi
[ "$#" -gt 0 ] || { echo "dryrun-guard: no command"; exit 1; }
exec "$@"
