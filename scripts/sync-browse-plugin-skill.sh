#!/usr/bin/env bash
# Diffs the canonical browse CLI skill against the browse-plugin repo's copy and,
# if changed, stages the update in $BROWSE_PLUGIN_DIR for the caller to commit/PR.
# Pure diff+copy logic — no network calls, no git remote operations — so it can be
# unit-tested against two local checkouts before wiring into CI.
set -euo pipefail

STAGEHAND_DIR="${STAGEHAND_DIR:?set STAGEHAND_DIR to the stagehand checkout root}"
BROWSE_PLUGIN_DIR="${BROWSE_PLUGIN_DIR:?set BROWSE_PLUGIN_DIR to the browse-plugin checkout root}"

SRC="$STAGEHAND_DIR/packages/cli/skills/browse/SKILL.md"
DST="$BROWSE_PLUGIN_DIR/skills/browse/SKILL.md"

if [[ ! -f "$SRC" ]]; then
  echo "error: canonical skill not found at $SRC" >&2
  exit 1
fi

if [[ ! -f "$DST" ]]; then
  echo "error: browse-plugin skill not found at $DST (has the repo been restructured?)" >&2
  exit 1
fi

if diff -q "$SRC" "$DST" > /dev/null 2>&1; then
  echo "changed=false"
  exit 0
fi

cp "$SRC" "$DST"
echo "changed=true"
