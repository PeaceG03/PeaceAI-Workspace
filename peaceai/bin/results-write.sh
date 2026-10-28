#!/usr/bin/env bash
# Clones Results, runs a recorder command against it, commits and pushes. On a push race it starts
# over from a fresh clone (records are append-only, summary.json is recomputed each time).
# Must run under with-deploy-key.sh. Usage: results-write.sh [--sparse <path>]... "<commit message>" <command...>
# The recorder sees RESULTS_DIR; its outputs reach GITHUB_OUTPUT only after a successful push.
# --sparse (Auditor follow-up on #564: Results grows ~20 MB per sweep arm): a blobless, shallow clone
# (--filter=blob:none --depth 1) with a no-cone sparse checkout of exactly the given literal paths ("/a/b/" a dir,
# "/a/b.json" a file); only their blobs are fetched, so every existence check and read of a path under them sees
# the real files. Each path must cover everything the recorder reads or writes. Fails closed: any file outside the
# paths (a write git would silently skip), any unstaged change, any staged path outside them, or any staged change
# that is not a new file (modify, delete, rename, type change) refuses before the commit; after the commit every
# added blob must equal the sha of the file written. Without --sparse: the full shallow clone, as before.
set -euo pipefail
sparse=()
while [ "${1-}" = --sparse ]; do
  [ "$#" -ge 2 ] || { echo "results-write: --sparse needs a path"; exit 1; }
  p="$2"
  [[ "$p" =~ ^(/[A-Za-z0-9._-]+)+/?$ && ! "$p" =~ (^|/)\.\.?(/|$) ]] || { echo "results-write: bad --sparse path: refused"; exit 1; }
  sparse+=("$p")
  shift 2
done
[ "$#" -ge 2 ] || { echo "results-write: usage: results-write.sh [--sparse <path>]... \"<commit message>\" <command...>"; exit 1; }
message="$1"
shift
default_remote="git@github.com:PeaceG03/PeaceAI-Results.git"
remote="${PEACEAI_RESULTS_REMOTE_OVERRIDE:-$default_remote}" # override is for local tests only
real_output="${GITHUB_OUTPUT:-/dev/null}"
# A repo-relative path is covered when it is a --sparse path or lies under one.
covered() { local q; for q in "${sparse[@]}"; do q="${q#/}"; q="${q%/}"; [ "$1" = "$q" ] || [ "${1:0:$((${#q} + 1))}" = "$q/" ] && return 0; done; return 1; }
sparse_checks() {
  local repo="$1" name bad
  bad=$(cd "$repo" && find . -path ./.git -prune -o ! -type d -print | sed 's|^\./||' | while IFS= read -r name; do covered "$name" || printf '%s\n' "$name"; done)
  [ -z "$bad" ] || { echo "results-write: file outside the --sparse paths: refused"; return 1; }
  [ -z "$(git -C "$repo" diff --name-only --no-renames)$(git -C "$repo" ls-files --others)" ] || { echo "results-write: change not staged (outside the sparse checkout?): refused"; return 1; }
  [ -z "$(git -C "$repo" diff --cached --name-only --no-renames --diff-filter=MDRTUXB)" ] || { echo "results-write: not append-only (modify, delete or rename): refused"; return 1; }
  while IFS= read -r name; do [ -z "$name" ] && continue
    covered "$name" || { echo "results-write: staged path outside the --sparse paths: refused"; return 1; }
  done <<< "$(git -C "$repo" diff --cached --name-only --no-renames)"
}
for attempt in 1 2 3 4 5; do
  work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/peaceai-results.XXXXXX")"
  outputs="$work.out"
  : > "$outputs"
  if [ "${#sparse[@]}" -eq 0 ]; then
    if ! git clone --quiet --depth 1 "$remote" "$work/repo" >/dev/null 2>&1; then
      echo "results clone failed"
      exit 1
    fi
  elif ! { git clone --quiet --depth 1 --filter=blob:none --no-checkout "$remote" "$work/repo" &&
           printf '%s\n' "${sparse[@]}" | git -C "$work/repo" sparse-checkout set --no-cone --stdin &&
           git -C "$work/repo" checkout --quiet; } >/dev/null 2>&1; then
    echo "results clone failed"
    exit 1
  fi
  RESULTS_DIR="$work/repo" GITHUB_OUTPUT="$outputs" "$@"
  git -C "$work/repo" add -A
  if [ "${#sparse[@]}" -gt 0 ]; then sparse_checks "$work/repo"; fi
  if git -C "$work/repo" diff --cached --quiet; then
    echo "nothing to record"
    cat "$outputs" >> "$real_output"
    exit 0
  fi
  git -C "$work/repo" -c user.name=PeaceG03 -c user.email=301894882+PeaceG03@users.noreply.github.com commit -q -m "$message"
  if [ "${#sparse[@]}" -gt 0 ]; then
    # What is committed is exactly what was written: new files only, each blob the sha of the file on disk.
    [ -z "$(git -C "$work/repo" diff-tree -r --no-commit-id --no-renames --diff-filter=MDRTUXB HEAD^ HEAD)" ] || { echo "results-write: commit is not append-only: refused"; exit 1; }
    while IFS= read -r name; do [ -z "$name" ] && continue
      [ "$(git -C "$work/repo" rev-parse "HEAD:$name")" = "$(git -C "$work/repo" hash-object -- "$name")" ] || { echo "results-write: committed blob differs from the file written: refused"; exit 1; }
    done <<< "$(git -C "$work/repo" diff-tree -r --no-commit-id --no-renames --name-only HEAD^ HEAD)"
  fi
  if git -C "$work/repo" push --quiet origin HEAD:main >/dev/null 2>&1; then
    sha="$(git -C "$work/repo" rev-parse HEAD)"
    when="$(git -C "$work/repo" show -s --format=%cI HEAD)"
    cat "$outputs" >> "$real_output"
    printf 'results_sha=%s\nresults_time=%s\n' "$sha" "$when" >> "$real_output"
    echo "results committed $sha at $when (attempt $attempt)"
    rm -rf "$work" "$outputs"
    exit 0
  fi
  echo "results push raced (attempt $attempt); retrying from a fresh clone"
  rm -rf "$work" "$outputs"
  sleep $((attempt * 3 + RANDOM % 5))
done
echo "results push failed after retries"
exit 1
