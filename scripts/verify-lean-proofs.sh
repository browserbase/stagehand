#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROOFS_DIR="${REPO_ROOT}/proofs"

if [ -d "${HOME}/.elan/bin" ]; then
  export PATH="${HOME}/.elan/bin:${PATH}"
fi

if ! command -v lake >/dev/null 2>&1; then
  echo "ERROR: 'lake' not found in PATH. Install Lean 4 via elan first." >&2
  exit 1
fi

echo "==> Scanning Lean proof sources for forbidden constructs (sorry, admit, axiom)..."
LEAN_FILES=()
while IFS= read -r -d '' file; do
  LEAN_FILES+=("${file}")
done < <(find "${PROOFS_DIR}" -path "${PROOFS_DIR}/.lake" -prune -o -name '*.lean' -print0)

if [ "${#LEAN_FILES[@]}" -eq 0 ]; then
  echo "ERROR: No .lean files found under ${PROOFS_DIR}" >&2
  exit 1
fi

if grep -En '\b(sorry|admit)\b' "${LEAN_FILES[@]}"; then
  echo "ERROR: Found forbidden 'sorry' or 'admit' in Lean proof files." >&2
  exit 1
fi

if grep -En '^[[:space:]]*(private[[:space:]]+|protected[[:space:]]+)?axiom[[:space:]]' "${LEAN_FILES[@]}"; then
  echo "ERROR: Found custom 'axiom' declaration in Lean proof files." >&2
  exit 1
fi

echo "==> Building Lean 4 proofs and oracle executable..."
cd "${PROOFS_DIR}"
BUILD_LOG="$(mktemp)"
trap 'rm -f "${BUILD_LOG}"' EXIT

lake build 2>&1 | tee "${BUILD_LOG}"

if grep -E '^warning:' "${BUILD_LOG}"; then
  echo "ERROR: Lean build emitted warnings." >&2
  exit 1
fi

echo "==> Running fresh axiom audit (StagehandProofs/AxiomAudit.lean)..."
AXIOM_OUTPUT="$(lake env lean StagehandProofs/AxiomAudit.lean 2>&1)"
printf '%s\n' "${AXIOM_OUTPUT}"

if printf '%s\n' "${AXIOM_OUTPUT}" | grep -Eq '\bsorryAx\b'; then
  echo "ERROR: Axiom audit detected 'sorryAx'!" >&2
  exit 1
fi

if ! printf '%s\n' "${AXIOM_OUTPUT}" | grep -Eq "depends on axioms:|does not depend on any axioms"; then
  echo "ERROR: Axiom audit produced no theorem axiom entries." >&2
  exit 1
fi

# Reject any axiom outside Lean's three standard logical axioms:
# propext, Classical.choice, Quot.sound. Handle multi-line axiom lists cleanly.
BAD_AXIOMS="$(
  printf '%s\n' "${AXIOM_OUTPUT}" \
    | tr '\n' ' ' \
    | grep -Eo 'depends on axioms: \[[^]]*\]' \
    | sed 's/depends on axioms: \[//; s/\]//' \
    | tr ',' '\n' \
    | tr -d ' \t\r' \
    | awk 'NF && $0 != "propext" && $0 != "Classical.choice" && $0 != "Quot.sound" { print }'
)"
if [ -n "${BAD_AXIOMS}" ]; then
  echo "ERROR: Unexpected non-standard axioms detected:" >&2
  printf '%s\n' "${BAD_AXIOMS}" >&2
  exit 1
fi

echo "==> Running stagehand-oracle reference checks..."
lake exe stagehand-oracle

echo "==> Validating stagehand-oracle --vectors JSON output..."
VECTORS_JSON="$(lake exe stagehand-oracle --vectors)"
if command -v node >/dev/null 2>&1; then
  printf '%s' "${VECTORS_JSON}" | node -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Expected non-empty JSON array of DomainPolicy vectors");
    }
    console.log(`Validated ${data.length} DomainPolicy JSON test vectors.`);
  '
fi

echo "==> All Lean 4 formal proofs, axiom audits, and oracle checks passed!"
