#!/usr/bin/env bash
# Clones Results, runs a recorder command against it, commits and pushes. On a push race it starts
# over from a fresh clone (records are append-only, summary.json is recomputed each time).
# Must run under with-deploy-key.sh. Usage: results-write.sh "<commit message>" <command...>
# The recorder sees RESULTS_DIR; its outputs reach GITHUB_OUTPUT only after a successful push.
set -euo pipefail
message="$1"
shift
default_remote="git@github.com:PeaceG03/PeaceAI-Results.git"
remote="${PEACEAI_RESULTS_REMOTE_OVERRIDE:-$default_remote}" # override is for local tests only
real_output="${GITHUB_OUTPUT:-/dev/null}"
for attempt in 1 2 3 4 5; do
  work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/peaceai-results.XXXXXX")"
  outputs="$work.out"
  : > "$outputs"
  if ! git clone --quiet --depth 1 "$remote" "$work/repo" >/dev/null 2>&1; then
    echo "results clone failed"
    exit 1
  fi
  RESULTS_DIR="$work/repo" GITHUB_OUTPUT="$outputs" "$@"
  git -C "$work/repo" add -A
  if git -C "$work/repo" diff --cached --quiet; then
    echo "nothing to record"
    cat "$outputs" >> "$real_output"
    exit 0
  fi
  git -C "$work/repo" -c user.name=PeaceG03 -c user.email=301894882+PeaceG03@users.noreply.github.com commit -q -m "$message"
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
