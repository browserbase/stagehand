import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  PYDANTIC_AI_SYSTEM_PROMPT,
  buildPydanticAiPrompt,
  buildPydanticAiSystemPrompt,
  parsePydanticAiResult,
  runPydanticAiAgent,
  type PydanticAiProcessSpawner,
} from "../../framework/pydanticAiRunner.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import type { PreparedPydanticAiToolAdapter } from "../../framework/pydanticAiToolAdapter.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

function eventSpawner(events: Array<Record<string, unknown>>): PydanticAiProcessSpawner {
  return () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    queueMicrotask(() => {
      for (const event of events) stdout.write(`${JSON.stringify(event)}\n`);
      stdout.end();
      stderr.end();
    });
    return {
      stdin,
      stdout,
      stderr,
      exited: Promise.resolve({ code: 0, signal: null }),
      kill: () => {},
    };
  };
}

describe("Pydantic AI runner", () => {
  it("builds a complete browser benchmark prompt", () => {
    const prompt = buildPydanticAiPrompt(plan, "Use snapshot and run.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("Use snapshot and run.");
    expect(prompt).toContain('"success": boolean');
    expect(prompt).toContain("Do not edit repository files.");
    expect(PYDANTIC_AI_SYSTEM_PROMPT).toContain("Only the browser tools matter.");
  });

  it("builds tool-surface-specific system prompts", () => {
    const facade = buildPydanticAiSystemPrompt("stagehand_facade");
    const playwright = buildPydanticAiSystemPrompt("playwright_mcp");
    expect(facade).toContain("snapshot");
    expect(facade).toContain("screenshot");
    expect(playwright).not.toContain("exactly three tools");
    expect(playwright).not.toContain("snapshot");
    expect(playwright).toContain("MCP browser tools");
  });

  it("sends the selected tool surface system prompt to the runner", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const spawn: PydanticAiProcessSpawner = () => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let raw = "";
      stdin.on("data", (chunk) => (raw += chunk.toString()));
      stdin.on("finish", () => payloads.push(JSON.parse(raw)));
      queueMicrotask(() => {
        stdout.write(
          `${JSON.stringify({ type: "final", text: '{"success":true,"summary":"done","finalAnswer":"ok"}' })}\n`,
        );
        stdout.write(`${JSON.stringify({ type: "usage" })}\n`);
        stdout.end();
        stderr.end();
      });
      return {
        stdin,
        stdout,
        stderr,
        exited: Promise.resolve({ code: 0, signal: null }),
        kill: () => {},
      };
    };
    const adapter = (toolSurface: "playwright_mcp" | "stagehand_facade") =>
      ({
        toolSurface,
        startupProfile: "tool_launch_local",
        cwd: "/tmp/pydantic-ai-test",
        env: {},
        promptInstructions: "Use mounted tools.",
        mcpServers: {},
        observedToolMatcher: () => false,
        cleanup: async () => {},
      }) satisfies PreparedPydanticAiToolAdapter;

    for (const toolSurface of ["playwright_mcp", "stagehand_facade"] as const) {
      await runPydanticAiAgent({
        plan,
        model: "openai/gpt-6-sol" as AvailableModel,
        logger: new EvalLogger(false),
        toolAdapter: adapter(toolSurface),
        spawn,
      });
    }

    expect(payloads[0]?.system_prompt).not.toContain("snapshot");
    expect(payloads[1]?.system_prompt).toContain("snapshot");
  });

  it("parses direct and marker JSON results", () => {
    expect(
      parsePydanticAiResult('{"success":true,"summary":"done","finalAnswer":"clicked"}'),
    ).toMatchObject({ success: true, summary: "done", finalAnswer: "clicked" });
    expect(
      parsePydanticAiResult('text\nEVAL_RESULT: {"success":true,"summary":"done"}'),
    ).toMatchObject({ success: true, summary: "done" });
  });

  it("streams a successful run into task metrics", async () => {
    const final = '{"success":true,"summary":"done","finalAnswer":"ok"}';
    const result = await runPydanticAiAgent({
      plan,
      model: "openai/gpt-6-sol" as AvailableModel,
      logger: new EvalLogger(false),
      spawn: eventSpawner([
        { type: "assistant", text: "working" },
        { type: "tool_call", id: "1", name: "run", server: "stagehand", args: {} },
        { type: "tool_result", id: "1", name: "run", server: "stagehand", ok: true, text: "ok" },
        { type: "final", text: final },
        {
          type: "usage",
          input_tokens: 100,
          output_tokens: 25,
          cache_read_input_tokens: 10,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        },
      ]),
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("ok");
    expect(result.harnessStatus).toBe("completed");
    expect(result.pydanticAiStatus).toBe("completed");
    expect(metrics.harness_input_tokens?.value).toBe(100);
    expect(metrics.harness_cached_input_tokens?.value).toBe(10);
    expect(metrics.harness_output_tokens?.value).toBe(25);
    expect(metrics.harness_reasoning_output_tokens?.value).toBe(5);
    expect(metrics.harness_total_tokens?.value).toBe(125);
    expect(metrics.harness_cost_usd).toBeUndefined();
    expect(metrics.pydanticAi_input_tokens).toBeUndefined();
  });

  it("returns a failed task result for recursion limits", async () => {
    const result = await runPydanticAiAgent({
      plan,
      model: "openai/gpt-6-sol" as AvailableModel,
      logger: new EvalLogger(false),
      spawn: eventSpawner([
        { type: "error", kind: "recursion_limit", message: "recursion limit reached" },
        { type: "final", text: "" },
        { type: "usage" },
      ]),
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("max_turns");
    expect(result.pydanticAiStatus).toBe("max_turns");
    expect(result.error).toContain("recursion");
  });
});
