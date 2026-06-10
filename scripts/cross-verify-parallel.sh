#!/usr/bin/env bash
# Parallel cross-verify: 8 verifier processes in flight at once across
# outcome-only plus the rubric approaches.

set -e
cd "$(dirname "$0")/.."

if [[ -n "${EVALS_ENV_FILE:-}" && -f "$EVALS_ENV_FILE" ]]; then
  set -a
  source "$EVALS_ENV_FILE"
  set +a
fi

PARALLEL=${PARALLEL:-8}
TRAJECTORY_GLOB=${TRAJECTORY_GLOB:-.trajectories/*}

DIRS=()
while IFS= read -r d; do
  DIRS+=("$d")
done < <(find $TRAJECTORY_GLOB -mindepth 1 -maxdepth 1 -type d | sort)

echo "[$(date +%H:%M:%S)] Found ${#DIRS[@]} trajectory dirs; parallelism=$PARALLEL"

run_one() {
  local dir="$1"
  local approach="$2"
  local label="cross-${approach}"
  local out_file="$dir/scores/result_${label}.json"
  local task
  task=$(basename "$dir")
  if [[ -f "$out_file" ]]; then
    echo "[$(date +%H:%M:%S)] [$approach] $task: skip (exists)"
    return 0
  fi
  local start
  start=$(date +%s)
  if VERIFIER_APPROACH=$approach VERIFIER_OPTIONAL_STEPS=folded \
       pnpm exec tsx packages/evals/cli.ts verify "$dir" --label "$label" > /tmp/verify-$$-$task-$approach.log 2>&1; then
    echo "[$(date +%H:%M:%S)] [$approach] $task: done in $(( $(date +%s) - start ))s"
  else
    echo "[$(date +%H:%M:%S)] [$approach] $task: FAILED in $(( $(date +%s) - start ))s; see /tmp/verify-$$-$task-$approach.log"
  fi
}
export -f run_one
export PARALLEL

# Build (dir, approach) job list and feed to xargs -P.
JOBS=()
for d in "${DIRS[@]}"; do
  JOBS+=("$d|outcome-only")
done
for d in "${DIRS[@]}"; do
  JOBS+=("$d|b")
done
for d in "${DIRS[@]}"; do
  JOBS+=("$d|a")
done

printf '%s\0' "${JOBS[@]}" | xargs -0 -I {} -n 1 -P "$PARALLEL" bash -c '
  IFS="|" read -r dir approach <<< "$1"
  run_one "$dir" "$approach"
' _ {}

echo "[$(date +%H:%M:%S)] All cross-verifications complete."
