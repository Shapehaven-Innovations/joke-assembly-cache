#!/usr/bin/env bash
# Daily history snapshot: write today's history/YYYY-MM-DD.json and push it, safely.
#
# Why this is a script: a scheduled run can start hours late and check out a stale commit (GitHub pins the event SHA when the
# run is created). A stale tree lacks the snapshot a newer run already pushed, so the old step re-created the same file and
# `git pull --rebase` died with an add/add conflict. Here every attempt first moves the working tree to the remote tip, so the
# snapshot decision is made against current history and a lost push race just retries from a fresh tip.
#
# Usage: publish-snapshot.sh [counts.json] [history-dir]
# Env:   GITHUB_REF_NAME (branch), and either REMOTE_URL or GH_TOKEN + REPO. MAX_ATTEMPTS (default 3).
# public/ and export.json are gitignored, so `reset --hard` leaves the freshly built files alone.
#
# The whole body is a function and the file ends with `main; exit`, so bash has parsed everything before `reset --hard` can
# replace this file on disk.
set -euo pipefail

main() {
  local counts="${1:-public/counts.json}" dir="${2:-history}"
  local branch="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
  local remote="${REMOTE_URL:-https://x-access-token:${GH_TOKEN:?GH_TOKEN is required}@github.com/${REPO:?REPO is required}.git}"
  local max="${MAX_ATTEMPTS:-3}" here day attempt
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"   # -P: snapshot-history.mjs only runs when argv[1] is its real path
  counts="$(cd "$(dirname "$counts")" && pwd -P)/$(basename "$counts")"   # absolute: survives the reset

  for ((attempt = 1; attempt <= max; attempt++)); do
    git fetch --quiet "$remote" "$branch"
    git reset --quiet --hard FETCH_HEAD

    day="$(node "$here/snapshot-history.mjs" "$counts" "$dir")"
    if [ -z "$day" ]; then
      git checkout --quiet -- "$dir" 2>/dev/null || true   # nothing to add; drop any prune-only edits, the next day's run commits them
      echo "publish-snapshot: today's snapshot is already on $branch"
      return 0
    fi

    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add -A "$dir"
    git diff --cached --quiet || git commit --quiet -m "history: $day"

    if git push --quiet "$remote" "HEAD:$branch"; then
      echo "publish-snapshot: pushed history: $day (attempt $attempt)"
      return 0
    fi
    echo "::warning::publish-snapshot: push attempt $attempt of $max was rejected; re-syncing to $branch and retrying"
    sleep $((attempt * 2))
  done

  echo "::error::publish-snapshot: could not push the daily snapshot after $max attempts"
  return 1
}

main "$@"
exit $?
