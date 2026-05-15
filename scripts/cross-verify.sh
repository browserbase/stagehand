#!/usr/bin/env bash
# Re-verify each stored trajectory under BOTH approaches via `bench verify`.
# Lets us isolate verifier disagreement from agent variance.
#
# Inputs: every trajectory dir matched by TRAJECTORY_GLOB.
# Outputs: scores/mmrubric_cross-{a,b}.json next to each trajectory.

set -e
cd "$(dirname "$0")/.."

if [[ -n "${EVALS_ENV_FILE:-}" && -f "$EVALS_ENV_FILE" ]]; then
  set -a
  source "$EVALS_ENV_FILE"
  set +a
fi

# Collect trajectory dirs from persisted verifier runs.
TRAJECTORY_GLOB=${TRAJECTORY_GLOB:-.trajectories/*}
DIRS=()
while IFS= read -r d; do
  DIRS+=("$d")
done < <(find $TRAJECTORY_GLOB -mindepth 1 -maxdepth 1 -type d | sort)

echo "Found ${#DIRS[@]} trajectory dirs"
for d in "${DIRS[@]}"; do
  task=$(basename "$d")
  echo "=== $(basename "$(dirname "$d")")/$task ==="
  for approach in b a; do
    label="cross-${approach}"
    out_file="$d/scores/mmrubric_${label}.json"
    if [[ -f "$out_file" ]]; then
      echo "  [$approach] already exists, skipping"
      continue
    fi
    echo "  [$approach] verifying..."
    start=$(date +%s)
    VERIFIER_APPROACH=$approach VERIFIER_OPTIONAL_STEPS=folded \
      pnpm exec tsx packages/evals/cli.ts verify "$d" --label "$label" > /dev/null 2>&1
    end=$(date +%s)
    echo "  [$approach] done in $((end - start))s"
  done
done

echo "All cross-verifications complete."
