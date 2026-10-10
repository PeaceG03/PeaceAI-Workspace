#!/usr/bin/env bash
# Runs a command with an SSH deploy key taken from $DEPLOY_KEY. The key is written to a
# private temp file, GitHub's host key is pinned, and the file is removed on exit.
# Never echoes the key. Usage: DEPLOY_KEY=... with-deploy-key.sh <command> [args...]
set -euo pipefail
if [ -z "${DEPLOY_KEY:-}" ]; then
  echo "deploy key unavailable" >&2
  exit 3
fi
umask 077
dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/peaceai-ssh.XXXXXX")"
trap 'rm -rf "$dir"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$dir/key"
unset DEPLOY_KEY
printf '%s\n' "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "$dir/known_hosts"
export GIT_SSH_COMMAND="ssh -i $dir/key -o IdentitiesOnly=yes -o IdentityAgent=none -o UserKnownHostsFile=$dir/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o LogLevel=ERROR"
"$@"
