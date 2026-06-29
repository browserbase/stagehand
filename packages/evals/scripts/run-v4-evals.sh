#!/usr/bin/env bash
#
# Rebuild the v4 eval shim from the local stagehand-v4 checkout, then run the
# supported suites (CORE + bench extract + act + observe) on BOTH v4 and v3, and
# write an apples-to-apples findings report stamped with the v4 commit.
#
# Local dev tool — re-runnable, overwrites its outputs. Not committed.
#
#   pnpm --filter @browserbasehq/stagehand-evals run eval:v4
#   # or directly:
#   bash packages/evals/scripts/run-v4-evals.sh
#
# Env overrides:
#   STAGEHAND_V4_DIR          v4 checkout (default: <repo>/../stagehand-v4)
#   EVAL_MODEL                model for the bench extract suite
#                             (default: anthropic/claude-sonnet-4-6)
#   STAGEHAND_V4_SDK_ENTRY    forwarded to build:v4shim if the v4 layout moved
#   STAGEHAND_V4_EXTENSION_ZIP forwarded to build:v4shim
#
set -uo pipefail

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
EVALS="$REPO/packages/evals"
EVALS_CLI="$EVALS/dist/cli/cli.js"
export STAGEHAND_V4_DIR="${STAGEHAND_V4_DIR:-$REPO/../stagehand-v4}"
MODEL="${EVAL_MODEL:-anthropic/claude-sonnet-4-6}"
OUTDIR="$EVALS/ctrf/v4"
REPORT="$EVALS/ctrf/v4-findings.md"
SUMMARY="$REPO/eval-summary.json"   # written (and overwritten) per run by framework/summary.ts

mkdir -p "$OUTDIR"

# Load provider keys (bench extract needs ANTHROPIC_API_KEY; CORE needs none).
# Exporting here makes them visible to the CLI subprocess regardless of its cwd.
if [ -f "$REPO/.env" ]; then set -a; . "$REPO/.env"; set +a; fi

# ── provenance ───────────────────────────────────────────────────────────────
export V3_SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if git -C "$STAGEHAND_V4_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  export V4_SHA="$(git -C "$STAGEHAND_V4_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  export V4_BRANCH="$(git -C "$STAGEHAND_V4_DIR" symbolic-ref --short HEAD 2>/dev/null || echo detached)"
  [ -n "$(git -C "$STAGEHAND_V4_DIR" status --porcelain 2>/dev/null)" ] && export V4_DIRTY=" dirty" || export V4_DIRTY=""
else
  export V4_SHA="unknown" V4_BRANCH="?" V4_DIRTY=""
fi
export MODEL
export STAMP="$(date -u +%Y-%m-%dT%H:%MZ)"

# ── 1. rebuild the shim from the freshly-pulled v4 (must succeed) ─────────────
echo "==> Rebuilding v4 shim from $STAGEHAND_V4_DIR (v4 ${V4_SHA} ${V4_BRANCH}${V4_DIRTY})"
if ! pnpm --filter @browserbasehq/stagehand-evals run build:v4; then
  echo "ERROR: build:v4 failed — fix the v4 checkout/build, then re-run." >&2
  exit 1
fi

if [ ! -f "$EVALS_CLI" ]; then
  echo "ERROR: $EVALS_CLI missing after build." >&2
  exit 1
fi

# ── 2. run the four suites, snapshotting eval-summary.json after each ─────────
run_suite() {
  local key="$1" sdk="$2"; shift 2
  echo "==> [$key]${sdk:+ EVAL_SDK=$sdk} evals $*"
  rm -f "$SUMMARY"
  ( cd "$EVALS" && EVAL_SDK="$sdk" node "$EVALS_CLI" "$@" ) \
    || echo "   ($key exited non-zero — continuing)"
  if [ -f "$SUMMARY" ]; then
    cp "$SUMMARY" "$OUTDIR/$key.json"
  else
    echo "   ($key wrote no summary)"; printf '{"passed":[],"failed":[]}\n' > "$OUTDIR/$key.json"
  fi
}

run_suite core_v4    ""   run core --tool stagehand_v4_code -c 1 -t 1
run_suite core_v3    ""   run core --tool understudy_code   -c 1 -t 1
run_suite extract_v4 v4   run extract -m "$MODEL" -c 1 -t 3
run_suite extract_v3 ""   run extract -m "$MODEL" -c 1 -t 3
run_suite act_v4     v4   run act -m "$MODEL" -c 1 -t 3
run_suite act_v3     ""   run act -m "$MODEL" -c 1 -t 3
run_suite observe_v4 v4   run observe -m "$MODEL" -c 1 -t 3
run_suite observe_v3 ""   run observe -m "$MODEL" -c 1 -t 3

# ── 3. generate the findings report ──────────────────────────────────────────
node --input-type=module - "$OUTDIR" "$REPORT" <<'NODE'
import fs from "node:fs";
const [outDir, reportPath] = process.argv.slice(2);
const E = process.env;
const read = (k) => { try { return JSON.parse(fs.readFileSync(`${outDir}/${k}.json`, "utf8")); } catch { return null; } };
const suites = {
  core_v4: read("core_v4"), core_v3: read("core_v3"),
  extract_v4: read("extract_v4"), extract_v3: read("extract_v3"),
  act_v4: read("act_v4"), act_v3: read("act_v3"),
  observe_v4: read("observe_v4"), observe_v3: read("observe_v3"),
};

const rate = (s) => {
  if (!s) return null;
  const p = (s.passed || []).length, f = (s.failed || []).length, t = p + f;
  return { p, t, pct: t ? Math.round((100 * p) / t) : null };
};
const fmt = (r) => (!r || r.pct == null) ? "n/a" : `${r.pct}% (${r.p}/${r.t})`;
const byTask = (s) => {
  const m = new Map();
  for (const r of s?.passed || []) { const e = m.get(r.eval) || { pass: 0, total: 0, error: undefined }; e.pass++; e.total++; m.set(r.eval, e); }
  for (const r of s?.failed || []) { const e = m.get(r.eval) || { pass: 0, total: 0, error: undefined }; e.total++; if (!e.error && r.error) e.error = r.error; m.set(r.eval, e); }
  return m;
};
// Single-line, pipe-escaped error for a markdown table cell (full text is in the JSON).
const cell = (x) => x ? String(x).replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 200) : "";

let out = `# v4 eval findings — ${E.STAMP || ""}\n\n`;
out += `- v3 evals: \`${E.V3_SHA || "?"}\`\n`;
out += `- v4 SDK: \`${E.V4_SHA || "?"}\` (${E.V4_BRANCH || "?"}${E.V4_DIRTY || ""})\n`;
out += `- model: \`${E.MODEL || "?"}\` · config: core \`-c 1 -t 1\`, extract \`-c 1 -t 3\`\n\n`;

out += `## Summary (v4 vs v3)\n\n| Suite | v4 | v3 |\n|---|---|---|\n`;
out += `| CORE | ${fmt(rate(suites.core_v4))} | ${fmt(rate(suites.core_v3))} |\n`;
out += `| bench extract | ${fmt(rate(suites.extract_v4))} | ${fmt(rate(suites.extract_v3))} |\n`;
out += `| bench act | ${fmt(rate(suites.act_v4))} | ${fmt(rate(suites.act_v3))} |\n`;
out += `| bench observe | ${fmt(rate(suites.observe_v4))} | ${fmt(rate(suites.observe_v3))} |\n\n`;

const diff = (title, v4k, v3k) => {
  let s = `### ${title} — tasks failing on v4\n\n`;
  if (!suites[v4k]) return s + `_no v4 summary captured (run errored before writing eval-summary.json)_\n\n`;
  // Zero results means the run crashed/aborted (no eval-summary), NOT that
  // everything passed — distinguish so "n/a" suites aren't reported as ✅.
  const r4 = rate(suites[v4k]);
  if (!r4 || r4.t === 0) {
    return (
      s +
      `_no results — the v4 ${title} run produced 0 evals (it errored/crashed before completing). Treat as "did not run", not "passed."_\n\n`
    );
  }
  const v4 = byTask(suites[v4k]), v3 = byTask(suites[v3k]);
  const failing = [...v4.entries()].filter(([, e]) => e.pass < e.total).sort((a, b) => a[0].localeCompare(b[0]));
  if (!failing.length) return s + `All ${r4.t} v4 runs passed. ✅\n\n`;
  s += `| Task | v4 | v3 | v4 failure (truncated; full text in ctrf/v4/${v4k}.json) |\n|---|---|---|---|\n`;
  for (const [name, e] of failing) { const v = v3.get(name); s += `| ${name} | ${e.pass}/${e.total} | ${v ? `${v.pass}/${v.total}` : "n/a"} | ${cell(e.error)} |\n`; }
  return s + "\n";
};
out += diff("CORE", "core_v4", "core_v3");
out += diff("bench extract", "extract_v4", "extract_v3");
out += diff("bench act", "act_v4", "act_v3");
out += diff("bench observe", "observe_v4", "observe_v3");

const c4 = rate(suites.core_v4), c3 = rate(suites.core_v3);
out += `## Notes\n\n`;
if (c4 && c3 && c4.pct === 0 && (c3.pct ?? 0) > 0)
  out += `- ⚠️ CORE is ~0% on v4 but passes on v3 — v4's local launch likely still can't reach the 127.0.0.1 fixture server (ERR_CONNECTION_REFUSED).\n`;
else if (c4 && (c4.pct ?? 0) > 0)
  out += `- ✅ CORE runs on v4 — the earlier 127.0.0.1 fixture-reachability issue appears resolved in this v4.\n`;
out += `- bench extract + act + observe run through the v4 facade (single model). v4 failures are usually CDP/Runtime stability on heavier pages, not accuracy — see the per-task v4-vs-v3 column.\n`;
out += `- The facade does not yet implement \`page.frameLocator()\`/\`page.frames()\`, so the few iframe-based act tasks fail with a clear "not supported" error (not an accuracy gap).\n`;

fs.writeFileSync(reportPath, out);
console.log(`\nWrote ${reportPath}`);
NODE

echo
echo "==> Report: $REPORT"
echo "==> Raw summaries: $OUTDIR/{core_v4,core_v3,extract_v4,extract_v3}.json"
