#!/bin/bash
# Kibitz: bring in the latest NEO, renamed to Kibitz, without fighting it.
#
# Branch upstream-kibitz holds each upstream NEO release run through
# tools/rebrand.py. Each of its commits has two parents, the previous
# rebranded commit and the upstream commit it came from, so git can follow
# the history. main merges upstream-kibitz, so a merge only conflicts where
# NEO and Kibitz both changed the same lines, never over the rename itself.
#
# Usage: tools/sync-upstream.sh   (make sync)
set -euo pipefail

BRANCH=upstream-kibitz
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "sync: commit or stash your changes first." >&2
  exit 1
fi

git fetch upstream
UP=$(git rev-parse upstream/main)
PREV=$(git rev-parse -q --verify "refs/heads/$BRANCH" || true)

if [ -n "$PREV" ] && git merge-base --is-ancestor "$UP" "$PREV"; then
  echo "sync: $BRANCH already has upstream $(git rev-parse --short "$UP")."
else
  WT=$(mktemp -d "${TMPDIR:-/tmp}/kibitz-rebrand.XXXXXX")
  trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || true; rm -rf "$WT"' EXIT
  git worktree add --detach "$WT" "$UP" >/dev/null
  python3 "$ROOT/tools/rebrand.py" "$WT"
  git -C "$WT" add -A
  TREE=$(git -C "$WT" write-tree)
  VERSION=$(git show "$UP:package.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  PARENTS=(-p "$UP")
  [ -n "$PREV" ] && PARENTS=(-p "$PREV" "${PARENTS[@]}")
  COMMIT=$(git commit-tree "$TREE" "${PARENTS[@]}" \
    -m "Upstream NEO $VERSION ($(git rev-parse --short "$UP")), renamed to Kibitz by tools/rebrand.py")
  git branch -f "$BRANCH" "$COMMIT"
  echo "sync: $BRANCH now at $(git rev-parse --short "$COMMIT") (NEO $VERSION)."
fi

git merge --no-edit "$BRANCH"
