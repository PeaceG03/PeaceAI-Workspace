#!/usr/bin/env bash
# M148 wiring (limit-breaker step 1): rolling LM saves in one private Cloudflare R2 bucket used only for these saves.
# Credentials come only from the environment of the calling workflow step (GitHub environment peaceai-results,
# main only): LM_SAVES_R2_ACCOUNT_ID, LM_SAVES_R2_ACCESS_KEY_ID, LM_SAVES_R2_SECRET_ACCESS_KEY, LM_SAVES_R2_BUCKET.
# Every key is <folder>/<chain id>/<save name>/<file> (folder lm-saves, or lb-daily for the daily cycle); nothing outside
# <folder>/<chain id>/ is read or written, and nothing in the bucket is ever removed or overwritten (a save
# name that already exists is refused with R2_SAVE_EXISTS; Auditor, #657). Output is one filtered line per action (codes,
# save names, step numbers and manifest sha256 only): no URL, no key, no bucket name, no aws output.
# The bucket is never trusted on its own: a resume needs the expected manifest sha256 from a trusted record (the
# previous run's job output passed by the chain job, or a job-log R2_PUT line), and train.py --resume-manifest-sha
# re-verifies the manifest and every file's sha256 and size before anything is loaded.
#
#   lm-saves-r2.sh check                         -> "R2 ok" or exit 1 with R2_NOT_CONFIGURED / R2_TOOL_MISSING
#   lm-saves-r2.sh put CHAIN SAVES_DIR           -> uploads new complete saves (manifest.json last); refuses a name already in the bucket
#   lm-saves-r2.sh get CHAIN SAVE DEST           -> downloads one save into DEST (must not exist yet)
#   lm-saves-r2.sh uploaded SAVES_DIR SAVE       -> exit 0 if SAVE was uploaded by put, else R2_SAVE_NOT_UPLOADED
#   lm-saves-r2.sh put-one CHAIN SAVES_DIR SAVE SHA
#                                                 -> uploads exactly SAVE (manifest.json last) only if its manifest sha256
#                                                    is SHA (else R2_SHA_MISMATCH) and CHAIN/SAVE/ is not in the bucket yet
#                                                    (else R2_SAVE_EXISTS); nothing is removed
# Optional first argument --folder lm-saves|lb-daily (default lm-saves): the daily cycle (peace-lb-daily.yml) keeps its
# saves under their own folder lb-daily/<chain id>/; no other folder is accepted (R2_BAD_ARGS).
set -uo pipefail

SAVE_RE='^save-[0-9]{9}$'
CHAIN_RE='^[0-9]{1,20}$'
FILE_RE='^[A-Za-z0-9._-]+$'

die() { echo "$1"; exit 1; }

F=lm-saves
if [ "${1:-}" = --folder ]; then
  case "${2:-}" in lm-saves|lb-daily) F=$2 ;; *) die R2_BAD_ARGS ;; esac
  shift 2
fi

setup() {
  [ -n "${LM_SAVES_R2_ACCOUNT_ID:-}" ] && [ -n "${LM_SAVES_R2_ACCESS_KEY_ID:-}" ] && [ -n "${LM_SAVES_R2_SECRET_ACCESS_KEY:-}" ] \
    && [ -n "${LM_SAVES_R2_BUCKET:-}" ] || die R2_NOT_CONFIGURED
  [[ "$LM_SAVES_R2_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] || die R2_NOT_CONFIGURED
  [[ "$LM_SAVES_R2_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || die R2_NOT_CONFIGURED
  [[ "$LM_SAVES_R2_ACCESS_KEY_ID" =~ ^[A-Za-z0-9]{16,128}$ ]] || die R2_NOT_CONFIGURED
  [[ "$LM_SAVES_R2_SECRET_ACCESS_KEY" =~ ^[A-Za-z0-9/+=]{16,256}$ ]] || die R2_NOT_CONFIGURED
  command -v aws > /dev/null 2>&1 || die R2_TOOL_MISSING
  export AWS_ACCESS_KEY_ID="$LM_SAVES_R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$LM_SAVES_R2_SECRET_ACCESS_KEY"
  export AWS_ENDPOINT_URL="https://$LM_SAVES_R2_ACCOUNT_ID.r2.cloudflarestorage.com" AWS_DEFAULT_REGION=auto
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  export AWS_PAGER="" AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
  B="$LM_SAVES_R2_BUCKET"
}

q() { aws "$@" --only-show-errors > /dev/null 2>&1; }

exists() { # exit 0 if <folder>/<chain>/<save>/ already has any object (s3 cp would silently overwrite it)
  local chain=$1 name=$2 out rc
  out=$(aws s3 ls "s3://$B/$F/$chain/" 2> /dev/null); rc=$?
  [ "$rc" = 0 ] || [ "$rc" = 1 ] && { [ "$rc" = 0 ] || [ -z "$out" ]; } || { echo "R2_LIST_FAILED"; return 2; }
  printf '%s\n' "$out" | awk '$1 == "PRE" { print $2 }' | tr -d / | grep -qx "$name"
}

put() {
  local chain=$1 dir=$2 state man sha f name rc=0
  [[ "$chain" =~ $CHAIN_RE ]] || die R2_BAD_ARGS
  [ -d "$dir" ] || return 0  # nothing saved yet: quiet (the training step calls this every minute)
  state="$dir/../r2-uploaded.txt"; touch "$state"
  for d in "$dir"/save-*; do
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    name=$(basename "$d"); [[ "$name" =~ $SAVE_RE ]] || continue
    grep -qx "$name" "$state" && continue
    man="$d/manifest.json"; [ -f "$man" ] || continue  # a save is visible only after its rename, manifest included
    sha=$(sha256sum "$man" | cut -c1-64)
    exists "$chain" "$name"; case $? in 0) echo "R2_SAVE_EXISTS save=$name"; rc=1; continue ;; 1) ;; *) rc=1; continue ;; esac
    for f in "$d"/*; do
      [ "$(basename "$f")" = manifest.json ] && continue
      [[ "$(basename "$f")" =~ $FILE_RE ]] && [ -f "$f" ] && [ ! -L "$f" ] || { echo "R2_PUT_REFUSED save=$name"; rc=1; continue 2; }
      q s3 cp "$f" "s3://$B/$F/$chain/$name/$(basename "$f")" || { [ -d "$d" ] && { echo "R2_PUT_FAILED save=$name"; rc=1; } || echo "R2_PUT_SKIPPED save=$name"; continue 2; }
    done
    # the manifest goes last: a save without its manifest is refused on resume (SAVE_MISSING / SAVE_MANIFEST_SHA)
    q s3 cp "$man" "s3://$B/$F/$chain/$name/manifest.json" || { [ -d "$d" ] && { echo "R2_PUT_FAILED save=$name"; rc=1; } || echo "R2_PUT_SKIPPED save=$name"; continue; }
    echo "$name" >> "$state"
    echo "R2_PUT save=$name manifest=$sha"
  done
  return $rc
}

put_one() {
  local chain=$1 dir=$2 name=$3 want=$4 d man f
  [[ "$chain" =~ $CHAIN_RE ]] && [[ "$name" =~ $SAVE_RE ]] && [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die R2_BAD_ARGS
  d="$dir/$name"; man="$d/manifest.json"
  [ -d "$d" ] && [ ! -L "$d" ] && [ -f "$man" ] && [ ! -L "$man" ] || die R2_PUT_REFUSED
  [ "$(sha256sum "$man" | cut -c1-64)" = "$want" ] || die R2_SHA_MISMATCH
  for f in "$d"/*; do
    [ "$(basename "$f")" = manifest.json ] && continue
    [[ "$(basename "$f")" =~ $FILE_RE ]] && [ -f "$f" ] && [ ! -L "$f" ] || die R2_PUT_REFUSED
  done
  exists "$chain" "$name"; case $? in 0) die R2_SAVE_EXISTS ;; 1) ;; *) exit 1 ;; esac
  for f in "$d"/*; do
    [ "$(basename "$f")" = manifest.json ] && continue
    q s3 cp "$f" "s3://$B/$F/$chain/$name/$(basename "$f")" || die R2_PUT_FAILED
  done
  q s3 cp "$man" "s3://$B/$F/$chain/$name/manifest.json" || die R2_PUT_FAILED
  echo "R2_PUT save=$name manifest=$want"
}

get() {
  local chain=$1 save=$2 dest=$3
  [[ "$chain" =~ $CHAIN_RE ]] && [[ "$save" =~ $SAVE_RE ]] || die R2_BAD_ARGS
  [ ! -e "$dest" ] || die R2_BAD_ARGS
  mkdir -p "$dest"
  q s3 cp "s3://$B/$F/$chain/$save/" "$dest/" --recursive || die R2_GET_FAILED
  [ -f "$dest/manifest.json" ] || die R2_GET_FAILED
  echo "R2_GET save=$save"
}

cmd=${1:-}
case "$cmd" in
  check) [ $# -eq 1 ] || die R2_BAD_ARGS; setup; echo "R2 ok" ;;
  put) [ $# -eq 3 ] || die R2_BAD_ARGS; setup; put "$2" "$3" ;;
  put-one) [ $# -eq 5 ] || die R2_BAD_ARGS; setup; put_one "$2" "$3" "$4" "$5" ;;
  get) [ $# -eq 4 ] || die R2_BAD_ARGS; setup; get "$2" "$3" "$4" ;;
  uploaded) [ $# -eq 3 ] || die R2_BAD_ARGS; [[ "$3" =~ $SAVE_RE ]] || die R2_BAD_ARGS
    grep -qx "$3" "$2/../r2-uploaded.txt" 2> /dev/null || die R2_SAVE_NOT_UPLOADED; echo "R2 uploaded save=$3" ;;
  *) die R2_BAD_ARGS ;;
esac
