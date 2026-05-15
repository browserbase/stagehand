/**
 * External-harness adapter smoke test — verifies the claudeCodeAdapter and
 * codexAdapter end-to-end without launching a browser.
 *
 * Hand-rolls synthetic harness results (tool-use messages for Claude Code,
 * ThreadEvents for Codex) and asserts:
 *   1. The produced Trajectory has the expected step count.
 *   2. Text and JSON modalities are populated where they should be.
 *   3. finalAnswer is captured.
 *   4. status === "complete".
 *
 * Bonus (gated on GEMINI_API_KEY): feeds the synthetic trajectory into a real
 * V3Evaluator.verify() with a tiny synthetic rubric, then prints the verdict.
 *
 * Run via:  pnpm exec tsx packages/evals/scripts/verify-harness-adapters.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { claudeCodeAdapter } from "../framework/harnesses/claudeCodeAdapter.js";
import { codexAdapter } from "../framework/harnesses/codexAdapter.js";
import { persistAdapterTrajectory } from "../framework/harnesses/persistTrajectory.js";
import type { TaskSpec, Trajectory } from "@browserbasehq/stagehand";

async function testClaudeCodeAdapter(taskSpec: TaskSpec): Promise<Trajectory> {
  // Hand-rolled SDK message stream that mirrors what the Claude Agent SDK
  // emits for a two-tool-call session with reasoning between them.
  const messages: Array<Record<string, unknown>> = [
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "I'll start by navigating to the United Airlines website.",
          },
          {
            type: "tool_use",
            id: "tu_1",
            name: "browse",
            input: { command: "browse navigate https://www.united.com" },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: [
              { type: "text", text: "Navigated to https://www.united.com" },
            ],
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "Now I'll look up the flight prices.",
          },
          {
            type: "tool_use",
            id: "tu_2",
            name: "browse",
            input: { command: "browse extract { economy, business } prices" },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_2",
            content: [
              {
                type: "text",
                text: '{"economy":"$1,200","business":"$5,200"}',
              },
            ],
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "The price difference is approximately $4,000 (business $5,200 vs economy $1,200).",
          },
        ],
      },
    },
    {
      type: "result",
      subtype: "success",
      result:
        "The price difference is approximately $4,000 (business $5,200 vs economy $1,200).",
      duration_ms: 1234,
      num_turns: 3,
    },
  ];

  const trajectory = claudeCodeAdapter.fromHarnessResult(
    {
      messages,
      status: "complete",
      usage: { input_tokens: 100, output_tokens: 80 },
    },
    taskSpec,
  );

  assert.equal(
    trajectory.steps.length,
    2,
    `expected 2 steps from 2 tool_use blocks, got ${trajectory.steps.length}`,
  );
  assert.equal(trajectory.steps[0].actionName, "browse");
  assert.equal(trajectory.steps[1].actionName, "browse");
  assert.equal(trajectory.status, "complete");
  assert.ok(
    trajectory.finalAnswer?.includes("$4,000"),
    `expected finalAnswer to include $4,000, got: ${trajectory.finalAnswer}`,
  );

  // Step 0: reasoning text modality + result text modality.
  const step0Modalities = trajectory.steps[0].agentEvidence.modalities;
  assert.ok(
    step0Modalities.some(
      (m) => m.type === "text" && m.content.includes("navigating"),
    ),
    "expected reasoning text in step 0 modalities",
  );
  assert.ok(
    step0Modalities.some(
      (m) =>
        m.type === "text" &&
        m.content.includes("Navigated to https://www.united.com"),
    ),
    "expected tool-result text in step 0 modalities",
  );

  // Step 1 carries the second reasoning + result content. tool_result content
  // is a structured array of {type, text} blocks, which the adapter forwards
  // as the json modality (with a stringified text mirror). Accept either path.
  const step1Modalities = trajectory.steps[1].agentEvidence.modalities;
  const step1Joined = JSON.stringify(step1Modalities);
  assert.ok(
    step1Joined.includes("economy"),
    `expected step 1 modalities to mention 'economy'; got ${step1Joined}`,
  );

  // Both steps must have empty probeEvidence — external harnesses don't
  // produce screenshots natively. That's what triggers evidence_insufficient
  // in the verifier downstream.
  for (const step of trajectory.steps) {
    assert.deepEqual(
      step.probeEvidence,
      {},
      `expected empty probeEvidence for external-harness step ${step.index}`,
    );
  }

  console.log(
    `  ✓ claudeCodeAdapter — ${trajectory.steps.length} steps, finalAnswer captured, probeEvidence empty`,
  );

  return trajectory;
}

async function testCodexAdapter(taskSpec: TaskSpec): Promise<Trajectory> {
  // Hand-rolled codex ThreadEvent stream. Mirrors what runCodexAgent
  // accumulates into its `events` array.
  const events: Array<Record<string, unknown>> = [
    { type: "thread.started", thread_id: "thread-smoke" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "rs-1",
        type: "reasoning",
        text: "I should start by navigating to the United website.",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "ce-1",
        type: "command_execution",
        command: "browse navigate https://www.united.com",
        aggregated_output: "Navigated to https://www.united.com",
        exit_code: 0,
        status: "completed",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "rs-2",
        type: "reasoning",
        text: "Now extract the prices via the MCP browser tool.",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "mc-1",
        type: "mcp_tool_call",
        server: "stagehand_browser",
        tool: "extract",
        arguments: { instruction: "Get prices" },
        result: {
          content: [
            {
              type: "text",
              text: '{"economy":"$1,200","business":"$5,200"}',
            },
          ],
          structured_content: { economy: "$1,200", business: "$5,200" },
        },
        status: "completed",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "am-1",
        type: "agent_message",
        text: "The price difference is approximately $4,000.",
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 10,
        output_tokens: 50,
        reasoning_output_tokens: 5,
      },
    },
  ];

  const trajectory = codexAdapter.fromHarnessResult(
    {
      events,
      status: "complete",
      usage: {
        input_tokens: 120,
        output_tokens: 50,
        reasoning_tokens: 5,
        cached_input_tokens: 10,
      },
    },
    taskSpec,
  );

  assert.equal(
    trajectory.steps.length,
    2,
    `expected 2 steps (command_execution + mcp_tool_call), got ${trajectory.steps.length}`,
  );
  assert.equal(trajectory.steps[0].actionName, "browse");
  assert.equal(trajectory.steps[1].actionName, "stagehand_browser.extract");
  assert.equal(trajectory.status, "complete");
  assert.ok(
    trajectory.finalAnswer?.includes("$4,000"),
    `expected finalAnswer to include $4,000, got: ${trajectory.finalAnswer}`,
  );

  // Reasoning items must be folded into the following tool call.
  assert.ok(
    trajectory.steps[0].reasoning.includes("navigating"),
    "expected first reasoning to be folded into step 0",
  );
  assert.ok(
    trajectory.steps[1].reasoning.includes("MCP browser tool"),
    "expected second reasoning to be folded into step 1",
  );

  // The MCP tool result should produce a json modality from structured_content.
  const step1Modalities = trajectory.steps[1].agentEvidence.modalities;
  assert.ok(
    step1Modalities.some(
      (m) =>
        m.type === "json" &&
        typeof m.content === "object" &&
        m.content !== null &&
        (m.content as Record<string, unknown>).economy === "$1,200",
    ),
    "expected json modality with structured_content on step 1",
  );

  // Probe evidence empty across the board.
  for (const step of trajectory.steps) {
    assert.deepEqual(
      step.probeEvidence,
      {},
      `expected empty probeEvidence for external-harness step ${step.index}`,
    );
  }

  console.log(
    `  ✓ codexAdapter — ${trajectory.steps.length} steps, reasoning folded, structured_content → json modality`,
  );

  return trajectory;
}

async function testPersistence(
  trajectory: Trajectory,
  taskSpec: TaskSpec,
  tmpRoot: string,
  label: string,
): Promise<void> {
  const { directory, persisted } = await persistAdapterTrajectory({
    trajectory,
    taskSpec,
    outputRoot: tmpRoot,
    runId: `smoke-${label}`,
    persist: true,
  });
  assert.equal(persisted, true);

  const entries = await fs.readdir(directory);
  assert.ok(
    entries.includes("task_data.json"),
    "expected task_data.json on disk",
  );
  assert.ok(
    entries.includes("trajectory.json"),
    "expected trajectory.json on disk",
  );
  assert.ok(entries.includes("times.json"), "expected times.json on disk");
  assert.ok(entries.includes("core.log"), "expected core.log on disk");
  assert.ok(entries.includes("scores"), "expected scores/ directory on disk");
  console.log(`  ✓ persistAdapterTrajectory(${label}) — wrote ${directory}`);
}

async function maybeRunVerifier(
  label: string,
  trajectory: Trajectory,
  taskSpec: TaskSpec,
): Promise<void> {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.log(
      `  – V3Evaluator.verify(${label}) skipped (no GEMINI_API_KEY in env)`,
    );
    return;
  }

  const { V3Evaluator } = await import("@browserbasehq/stagehand");
  // Construct a V3 stub just for its logger (V3Evaluator only needs that).
  // We can't `init()` it (no browser) but the verify path never touches the
  // browser, only LLMProvider.
  const { V3 } = await import("@browserbasehq/stagehand");
  // V3 requires V3Options; pass a minimal one with disablePino so we don't
  // spin up the pino worker.
  const v3 = new V3({ env: "LOCAL", verbose: 0, disablePino: true });

  const evaluator = new V3Evaluator(v3, { backend: "verifier" });
  try {
    const verdict = await evaluator.verify(trajectory, taskSpec);
    console.log(
      `  ✓ V3Evaluator.verify(${label}) — outcome=${verdict.outcomeSuccess} process=${verdict.processScore.toFixed(2)} criteria=${verdict.perCriterion.length} evidence_insufficient=${verdict.evidenceInsufficient.length}`,
    );
  } finally {
    // V3 instance was never init'd, no teardown needed.
  }
}

async function main(): Promise<void> {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "verify-harness-adapters-"),
  );
  console.log(`▸ tmpdir: ${tmpRoot}\n`);

  const taskSpec: TaskSpec = {
    id: "smoke-united_13",
    instruction:
      "What is the price difference between economy and business class on United CHI→GRU?",
    initUrl: "https://www.united.com",
    precomputedRubric: {
      items: [
        {
          criterion: "Identify correct route",
          description:
            "Agent identifies the United CHI→GRU economy and business class fares.",
          maxPoints: 2,
        },
        {
          criterion: "Report price delta",
          description:
            "Agent reports a numeric difference between economy and business.",
          maxPoints: 3,
        },
      ],
    },
    expectedAnswer: "Approximately $4,000 difference.",
  };

  console.log("▸ claudeCodeAdapter");
  const claudeTrajectory = await testClaudeCodeAdapter(taskSpec);
  await testPersistence(claudeTrajectory, taskSpec, tmpRoot, "claude_code");
  await maybeRunVerifier("claude_code", claudeTrajectory, taskSpec);

  console.log("\n▸ codexAdapter");
  const codexTrajectory = await testCodexAdapter(taskSpec);
  await testPersistence(codexTrajectory, taskSpec, tmpRoot, "codex");
  await maybeRunVerifier("codex", codexTrajectory, taskSpec);

  console.log("\n✓ all smoke assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
