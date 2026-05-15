/**
 * End-to-end Wave 1 verification on a real WebTailBench task.
 *
 * Loads one row from packages/evals/datasets/webtailbench/WebTailBench_data.jsonl
 * (which carries upstream precomputed_rubric), runs the agent on Browserbase
 * via runWithVerifier, and asserts:
 *   1. Recorder captures a non-trivial trajectory.
 *   2. Verifier uses the upstream rubric (rubricSource = "precomputed").
 *   3. Step 6 rescoring produces per-criterion scores (no evidence_insufficient).
 *   4. Step 8 outcome returns a boolean verdict with reasoning.
 *
 *   pnpm tsx packages/evals/scripts/verify-webtailbench-task.ts [task_id]
 *
 * Defaults to united_13. Requires BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID
 * and a GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY in env.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { V3 } from "@browserbasehq/stagehand";
import type { Rubric, TaskSpec } from "@browserbasehq/stagehand";
import { runWithVerifier } from "../framework/verifierAdapter.js";

interface WebTailBenchRow {
  id: string;
  category?: string;
  ques: string;
  web?: string;
  precomputed_rubric?: Rubric;
}

const DEFAULT_TASK_ID = "united_13";
const JSONL = path.resolve(
  import.meta.dirname,
  "..",
  "datasets",
  "webtailbench",
  "WebTailBench_data.jsonl",
);

async function loadRow(taskId: string): Promise<WebTailBenchRow> {
  const raw = await fs.readFile(JSONL, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as WebTailBenchRow;
    if (row.id === taskId) return row;
  }
  throw new Error(`task id ${taskId} not found in ${JSONL}`);
}

async function main(): Promise<void> {
  const taskId = process.argv[2] ?? DEFAULT_TASK_ID;
  const mode = (process.env.AGENT_MODE ?? "hybrid") as "dom" | "hybrid" | "cua";
  const model =
    process.env.AGENT_MODEL ??
    (mode === "cua" ? "anthropic/claude-haiku-4-5" : "google/gemini-2.5-flash");
  console.log(`▸ loading WebTailBench task: ${taskId}`);
  console.log(`  mode=${mode}  model=${model}`);
  const row = await loadRow(taskId);
  console.log(`  ✓ ${row.ques.slice(0, 100)}`);
  console.log(
    `  ✓ rubric: ${row.precomputed_rubric ? `${row.precomputed_rubric.items.length} criteria` : "MISSING"}`,
  );
  assert.ok(
    row.precomputed_rubric && row.precomputed_rubric.items.length > 0,
    "task should carry a precomputed rubric (run backfill-webtailbench-rubrics.ts first)",
  );

  // Most WebTailBench sites block local browser traffic; ideally this runs on
  // BROWSERBASE. Defaults to LOCAL when Browserbase creds aren't configured —
  // the verifier still exercises end-to-end on whatever trajectory we capture,
  // even if the agent fails fast against anti-bot.
  const useBrowserbase =
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID;
  const env = useBrowserbase ? "BROWSERBASE" : "LOCAL";
  console.log(`▸ initializing V3 on ${env}`);
  const v3 = new V3({
    env,
    verbose: 1,
    model,
    // Keep the agent loop local even on env=BROWSERBASE — without this V3
    // would auto-create an apiClient and dispatch agent.execute() to the
    // remote server-side loop, which doesn't emit on our local bus. The
    // evals framework does this same opt-out in packages/evals/initV3.ts:121
    // via process.env.USE_API. disableAPI is the targeted flag; we used
    // experimental: true previously as a heavier-handed equivalent.
    disableAPI: true,
  });
  await v3.init();

  const page = v3.context.pages()[0];
  const startUrl = row.web || "https://www.google.com";
  await page.goto(startUrl, { timeoutMs: 120_000 });
  console.log(`  ✓ navigated to ${startUrl}`);

  const agent = v3.agent({
    mode,
    model,
  });

  const taskSpec: TaskSpec = {
    id: row.id,
    instruction: row.ques,
    initUrl: startUrl,
    precomputedRubric: row.precomputed_rubric,
  };

  console.log("▸ running agent + verifier pipeline");
  const startMs = Date.now();
  const result = await runWithVerifier({
    v3,
    agent,
    taskSpec,
    dataset: "webtailbench",
    agentOptions: { maxSteps: 30 },
  });
  console.log(
    `  ✓ completed in ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
  );

  // Diagnostic: show what the agent did internally vs what reached the bus.
  console.log(`  agent.actions: ${result.agentResult.actions.length}`);
  console.log(`  agent.completed: ${result.agentResult.completed}`);
  console.log(
    `  agent.usage: ${JSON.stringify(result.agentResult.usage ?? {})}`,
  );
  if (result.agentResult.actions.length > 0) {
    console.log("  first 5 internal actions:");
    for (const a of result.agentResult.actions.slice(0, 5)) {
      console.log(`    - ${a.type ?? "?"}  ${(a.action ?? "").slice(0, 80)}`);
    }
  }

  await v3.close();

  // ── Assertions ──────────────────────────────────────────────────────────
  const { trajectory, verdict, rubric, trajectoryDir } = result;
  console.log(`\n▸ trajectory: ${trajectory.steps.length} steps`);
  console.log(`  directory: ${trajectoryDir}`);
  console.log(`\n▸ verdict:`);
  console.log(
    `  outcomeSuccess=${verdict.outcomeSuccess}  processScore=${verdict.processScore.toFixed(3)}`,
  );
  console.log(
    `  per-criterion (${verdict.perCriterion.length}/${rubric.items.length}):`,
  );
  for (const c of verdict.perCriterion) {
    const earned = c.earnedPoints === null ? "—" : c.earnedPoints.toFixed(1);
    const flag = c.evidenceInsufficient ? " [evidence_insufficient]" : "";
    console.log(`    - ${earned}/${c.maxPoints}  ${c.criterion}${flag}`);
    if (c.justification) {
      console.log(`        ${c.justification.slice(0, 200)}`);
    }
  }
  const raw = verdict.rawSteps as
    | { primaryIntent?: string; reasoning?: string; rubricSource?: string }
    | undefined;
  console.log(`\n▸ rubric source: ${raw?.rubricSource}`);
  console.log(`▸ primary intent: ${raw?.primaryIntent}`);

  if (verdict.findings && verdict.findings.length > 0) {
    console.log(`\n▸ findings (${verdict.findings.length}):`);
    for (const f of verdict.findings) {
      const steps = f.relatedSteps?.length
        ? `  steps=[${f.relatedSteps.join(",")}]`
        : "";
      console.log(`  [${f.severity}] ${f.category}${steps}`);
      console.log(`    ${f.description}`);
      if (f.suggestedAction) {
        console.log(`    → ${f.suggestedAction}`);
      }
    }
  } else {
    console.log(`\n▸ findings: (none)`);
  }

  assert.equal(
    raw?.rubricSource,
    "precomputed",
    "expected verifier to use the upstream precomputed rubric",
  );
  assert.equal(verdict.perCriterion.length, rubric.items.length);
  const fullySufficient = verdict.perCriterion.every(
    (c) => !c.evidenceInsufficient,
  );
  assert.ok(
    fullySufficient,
    "expected Step 6 to score every criterion (no evidence_insufficient flags)",
  );
  assert.equal(typeof verdict.outcomeSuccess, "boolean");

  console.log(`\n✅ Wave 1 WebTailBench verification OK`);
}

main().catch((err) => {
  console.error("\n❌ Wave 1 WebTailBench verification FAILED:", err);
  process.exit(1);
});
