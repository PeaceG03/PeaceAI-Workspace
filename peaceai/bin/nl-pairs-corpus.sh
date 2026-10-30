#!/usr/bin/env bash
# M147: build the English-to-code pair corpus on the box, through the retrain's own dedup and decontamination.
#   nl-pairs-corpus.sh <work> <judge-items.json> <exclusion file> [--write]
# 1. nl-pairs.ts (clones in <work>/src; licence, exclusion, scrub, file-filter and cap rules) -> <work>/nl-pairs;
# 2. ft_prepare.py (the retrain's step 2b: one version per (repo, path, function), split by file path, heldout docs
#    sharing a significant line with train dropped; finetune.ftLineMinChars) -> <work>/nl-raw, <work>/nl-prepare.json;
# 3. set C v2 (ext-fetch.ts --set-c) into <work>/setc unless present; the judge items must match eval.judgeItemsSha256;
# 4. eval_dedup.py against set C v2 and the judge items (dedup.window / dedup.shortMin) -> <work>/nl, <work>/nl-dedup.json;
# 5. --write: nl-pairs.ts --write-manifest (sha256 manifest + counts summary into peaceai/model/).
# The exclusion file is required (no default). Text stays in <work>; counts and codes only on stdout.
set -euo pipefail
[ "$#" -ge 3 ] || { echo "nl-pairs-corpus refused: usage"; exit 1; }
work="$1"; items="$2"; excl="$3"; write="${4:-}"
[ -f "$excl" ] || { echo "nl-pairs-corpus refused: exclusions_missing"; exit 1; }
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:-python3}"
[ "$(sha256sum "$items" | cut -d' ' -f1)" = "$(jq -r .eval.judgeItemsSha256 "$cfg")" ] || { echo "nl-pairs-corpus refused: judge_items_sha"; exit 1; }
mkdir -p "$work"
./node_modules/.bin/tsx peaceai/bin/nl-pairs.ts --exclusions "$excl" --src "$work/src" --out "$work/nl-pairs"
rm -rf "$work/nl-raw" "$work/nl"
"$py" peaceai/model/ft_prepare.py --in "$work/nl-pairs" --out "$work/nl-raw" --report "$work/nl-prepare.json" --line-min-chars "$(jq -r .finetune.ftLineMinChars "$cfg")"
if [ ! -f "$work/setc/docs.jsonl" ]; then ./node_modules/.bin/tsx peaceai/bin/ext-fetch.ts "$work/csrc" "$work/setc" --set-c; rm -rf "$work/csrc"; fi
"$py" peaceai/model/eval_dedup.py --corpus "$work/nl-raw" --setc "$work/setc" --judge "$items" --out "$work/nl" --report "$work/nl-dedup.json" \
  --window "$(jq -r .dedup.window "$cfg")" --short-min "$(jq -r .dedup.shortMin "$cfg")"
rm -rf "$work/nl-raw"
if [ "$write" = "--write" ]; then ./node_modules/.bin/tsx peaceai/bin/nl-pairs.ts --write-manifest "$work/nl" --report-dir "$work"; fi
