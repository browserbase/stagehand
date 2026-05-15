/**
 * Wave 0 end-to-end verification — runs a tiny live agent task and asserts the
 * TrajectoryRecorder captures bus events from the real v3AgentHandler.
 *
 * Deliberately minimal: env=LOCAL (no Browserbase costs), 3 max steps, a stable
 * destination, and a DOM-mode agent. The goal is to confirm bus event wiring,
 * not to test agent capability.
 *
 *   pnpm tsx packages/evals/scripts/verify-live-trajectory.ts
 *
 * Requires one of GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY in env.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { V3, V3Evaluator } from "@browserbasehq/stagehand";
import type { TaskSpec } from "@browserbasehq/stagehand";
import { TrajectoryRecorder } from "../framework/trajectoryRecorder.js";

async function main(): Promise<void> {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "verifier-rewrite-live-"),
  );
  console.log(`▸ tmpdir: ${tmpRoot}`);

  const v3 = new V3({
    env: "LOCAL",
    verbose: 0,
    model: "google/gemini-2.5-flash",
  });
  await v3.init();
  console.log("  ✓ V3 initialized");

  const page = v3.context.pages()[0];
  await page.goto("https://example.com", { timeoutMs: 60_000 });
  console.log("  ✓ navigated to example.com");

  const taskSpec: TaskSpec = {
    id: "live-example-com",
    instruction: "Extract the heading text from example.com",
    initUrl: "https://example.com",
  };

  const recorder = new TrajectoryRecorder({
    v3,
    taskSpec,
    outputRoot: tmpRoot,
    runId: "live-run",
    persist: true,
  });
  recorder.start();
  console.log("  ✓ TrajectoryRecorder subscribed to bus");

  const agent = v3.agent({
    model: "google/gemini-2.5-flash",
    mode: "dom",
  });

  const start = Date.now();
  const result = await agent.execute({
    instruction:
      "Extract the main heading text on the current page using the extract tool, then call done with that text as the reasoning.",
    maxSteps: 3,
  });
  console.log(`  ✓ agent.execute completed in ${Date.now() - start}ms`);
  console.log(`    final message: "${result.message}"`);
  console.log(`    actions: ${result.actions.length}`);

  const trajectory = await recorder.finish({
    status: "complete",
    finalAnswer: result.message,
    usage: result.usage,
  });

  await v3.close();
  console.log("  ✓ V3 closed");

  // ── Assertions ──────────────────────────────────────────────────────────
  assert.ok(
    trajectory.steps.length > 0,
    `expected at least 1 trajectory step, got ${trajectory.steps.length}`,
  );
  console.log(`  ✓ trajectory has ${trajectory.steps.length} steps`);

  const stepsWithScreenshot = trajectory.steps.filter(
    (s) => s.probeEvidence.screenshotPath || s.probeEvidence.screenshot,
  );
  assert.ok(
    stepsWithScreenshot.length > 0,
    "expected at least one step with a probe screenshot",
  );
  console.log(
    `  ✓ ${stepsWithScreenshot.length}/${trajectory.steps.length} steps carry a probe screenshot`,
  );

  const stepsWithUrl = trajectory.steps.filter(
    (s) => typeof s.probeEvidence.url === "string" && s.probeEvidence.url,
  );
  assert.ok(
    stepsWithUrl.length > 0,
    "expected at least one step with a probe url",
  );
  console.log(
    `  ✓ ${stepsWithUrl.length}/${trajectory.steps.length} steps carry a probe url`,
  );

  const stepsWithEvidence = trajectory.steps.filter(
    (s) => s.agentEvidence.modalities.length > 0,
  );
  assert.ok(
    stepsWithEvidence.length > 0,
    "expected at least one step with tier-1 agent evidence modalities",
  );
  console.log(
    `  ✓ ${stepsWithEvidence.length}/${trajectory.steps.length} steps carry tier-1 evidence`,
  );

  // ── On-disk layout ─────────────────────────────────────────────────────
  const taskDir = path.join(tmpRoot, "live-run", "live-example-com");
  const files = await fs.readdir(taskDir);
  assert.ok(files.includes("trajectory.json"), "trajectory.json missing");
  assert.ok(files.includes("task_data.json"), "task_data.json missing");
  assert.ok(files.includes("times.json"), "times.json missing");
  const screenshotFiles = files.filter((f) => f.startsWith("screenshot_"));
  assert.ok(
    screenshotFiles.length > 0,
    "expected at least one persisted screenshot",
  );
  console.log(
    `  ✓ on-disk: trajectory.json + task_data.json + times.json + ${screenshotFiles.length} screenshots`,
  );

  // ── verify() runs Wave 1 pipeline on the live trajectory ──────────────
  console.log("\n▸ running V3Evaluator.verify() (Step 0a + Step 8)…");
  const verdict = await new V3Evaluator(v3, { backend: "verifier" }).verify(
    trajectory,
    taskSpec,
  );
  console.log(
    `  ✓ generated rubric with ${verdict.perCriterion.length} criteria`,
  );
  console.log(
    `  ✓ outcomeSuccess=${verdict.outcomeSuccess}, processScore=${verdict.processScore}`,
  );
  assert.equal(typeof verdict.outcomeSuccess, "boolean");
  assert.ok(
    verdict.perCriterion.length > 0,
    "expected generated rubric to have at least one criterion",
  );
  const raw = verdict.rawSteps as
    | { primaryIntent?: string; rubricSource?: string }
    | undefined;
  assert.equal(raw?.rubricSource, "generated");
  assert.ok(
    typeof raw?.primaryIntent === "string" && raw.primaryIntent.length > 0,
    "expected outcome verifier to populate primary_intent",
  );
  console.log(`    primary_intent: "${raw.primaryIntent.slice(0, 120)}"`);

  console.log(`\n✅ Wave 0 live verification OK — trajectory at ${taskDir}`);
  // Keep tmpdir for inspection; user can rm -rf if needed.
}

main().catch((err) => {
  console.error("\n❌ Wave 0 live verification FAILED:", err);
  process.exit(1);
});
