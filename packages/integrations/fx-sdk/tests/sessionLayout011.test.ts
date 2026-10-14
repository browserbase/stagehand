import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FX_REASONING_EFFORTS,
  normalizeFxModel,
  parseFxReasoningEffort,
  runFxSession,
  type FxEvent,
  type FxProcessRunner,
  type FxToolCallRecord,
} from "../src/index.js";

// Fixtures are scrubbed copies of real fx 0.0.11 session directories:
// `committed` is a finished turn (events.jsonl stream, schema_version 3) and
// `in-flight` is a turn killed mid-run (empty events.jsonl + recovery.json).
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fx-0.0.11");
const logger = { log: () => {}, warn: () => {}, error: () => {} };
const homes: string[] = [];

async function homeWithSession(fixture: "committed" | "in-flight"): Promise<string> {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "fx-sdk-011-"));
  homes.push(home);
  await fsp.cp(path.join(FIXTURES, fixture), path.join(home, ".fx", "sessions", "S3ss10nId"), {
    recursive: true,
  });
  return home;
}

function toolSteps(events: FxEvent[]) {
  return events.filter(
    (event): event is Extract<FxEvent, { type: "tool_step" }> => event.type === "tool_step",
  );
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fsp.rm(home, { recursive: true, force: true })));
});

describe("fx 0.0.11 session layout", () => {
  it("reconstructs tool steps and outputs from the events.jsonl stream", async () => {
    const home = await homeWithSession("committed");
    const finalOutput =
      '```json\n{"success":true,"summary":"Found the textbook prices.","finalAnswer":"Strang: $58.00"}\n```';
    const result = await runFxSession({
      prompt: "task",
      cwd: home,
      home,
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({
          output: `I'll start by selecting the Stagehand browser tools.\n\n${finalOutput}`,
          final_output: finalOutput,
          exit_code: 0,
          steps: 3,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    const steps = toolSteps(result.events);
    expect(steps.map((step) => step.tool_calls.map((call) => call.name))).toEqual([
      ["mcp_select_tool", "mcp_select_tool"],
      ["mcp_stagehand_run"],
    ]);
    expect(steps[0]?.assistant).toBe("I'll start by selecting the Stagehand browser tools.");
    const run = steps[1]!;
    expect(JSON.parse(run.tool_calls[0]!.arguments_json!)).toHaveProperty("code");
    expect(run.tool_results[0]).toMatchObject({
      tool_call_id: run.tool_calls[0]!.id,
      status: "success",
    });
    // The full output comes from tool-results/, not the 60-character preview.
    expect(run.tool_results[0]!.output).toContain("Introduction to Linear Algebra");
    expect(steps[0]!.tool_results[0]!.output).toContain("Selected dynamic MCP tool");
    // The deliverable is the final response alone, not the narration.
    expect(result.finalMessage).toBe(finalOutput);
    expect(result.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toContain("turn_committed");
  });

  it("falls back to the stream's final assistant message without final_output", async () => {
    const home = await homeWithSession("committed");
    const result = await runFxSession({
      prompt: "task",
      cwd: home,
      home,
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ output: "narration\n\n```json\n{}\n```", exit_code: 0 }),
        stderr: "",
        exitCode: 0,
      }),
    });
    expect(result.finalMessage).toMatch(/^```json\n\{"success":true/u);
    expect(result.finalMessage).toContain("ThriftBooks");
  });

  it("recovers the steps of a turn killed mid-run from recovery.json", async () => {
    const home = await homeWithSession("in-flight");
    const result = await runFxSession({
      prompt: "task",
      cwd: home,
      home,
      env: {},
      logger,
      runProcess: async () => ({ stdout: "", stderr: "killed", exitCode: null, signal: "SIGKILL" }),
    });
    const steps = toolSteps(result.events);
    expect(steps.flatMap((step) => step.tool_calls.map((call) => call.name))).toEqual([
      "mcp_select_tool",
      "mcp_select_tool",
      "mcp_select_tool",
      "mcp_stagehand_run",
      "mcp_stagehand_screenshot",
    ]);
    const results = steps.flatMap((step) => step.tool_results);
    expect(results.find((r) => r.tool_name === "mcp_stagehand_run")?.output).toContain(
      "hostelworld",
    );
    // Screenshot image blocks live in a second artifact and are merged back in.
    const screenshot = JSON.parse(
      results.find((r) => r.tool_name === "mcp_stagehand_screenshot")!.output!,
    );
    expect(screenshot.result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: expect.stringMatching(/^iVBOR/u),
    });
    expect(result.status).toBe("sdk_error");
  });

  it("preserves screenshot artifacts larger than the text output limit", async () => {
    const home = await homeWithSession("in-flight");
    const artifacts = path.join(home, ".fx", "sessions", "S3ss10nId", "tool-results");
    const imageFile = (await fsp.readdir(artifacts)).find((name) =>
      name.startsWith("image-result-"),
    )!;
    const data = "a".repeat(1024 * 1024);
    await fsp.writeFile(
      path.join(artifacts, imageFile),
      JSON.stringify([{ type: "image", mimeType: "image/png", data }]),
    );
    const result = await runFxSession({
      prompt: "task",
      cwd: home,
      home,
      env: {},
      logger,
      runProcess: async () => ({ stdout: "", stderr: "killed", exitCode: null, signal: "SIGKILL" }),
    });
    const screenshot = toolSteps(result.events)
      .flatMap((step) => step.tool_results)
      .find((r) => r.tool_name === "mcp_stagehand_screenshot");
    expect(JSON.parse(screenshot!.output!).result.content[1].data).toBe(data);
  });

  it("tails recovery.json for live observations while fx runs", async () => {
    const home = await homeWithSession("in-flight");
    let release: (() => void) | undefined;
    const observed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onToolStep = vi.fn((_call: FxToolCallRecord) => {
      if (onToolStep.mock.calls.length === 2) release?.();
    });
    const result = await runFxSession({
      prompt: "task",
      cwd: home,
      home,
      env: {},
      logger,
      pollIntervalMs: 1,
      onToolStep,
      observedTool: (name) => name.startsWith("mcp_stagehand_"),
      runProcess: async () => {
        await observed;
        return { stdout: JSON.stringify({ output: "", exit_code: 0 }), stderr: "", exitCode: 0 };
      },
    });
    expect(onToolStep.mock.calls.map(([call]) => call.name)).toEqual([
      "mcp_stagehand_run",
      "mcp_stagehand_screenshot",
    ]);
    expect(result.observedToolCallKeys).toHaveLength(2);
  });

  it("passes model and effort as flags and records them as session defaults", async () => {
    const home = await homeWithSession("committed");
    await fsp.writeFile(
      path.join(home, ".fx", "settings.json"),
      JSON.stringify({ permission: { run_command: "deny" } }),
    );
    let captured: Parameters<FxProcessRunner>[0] | undefined;
    await runFxSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-5-5",
      reasoningEffort: "high",
      cwd: home,
      home,
      env: {},
      logger,
      runProcess: async (input) => {
        captured = input;
        return { stdout: JSON.stringify({ output: "ok", exit_code: 0 }), stderr: "", exitCode: 0 };
      },
    });
    expect(captured?.args).toEqual([
      "ask",
      "--json",
      "--auto",
      "--model",
      "anthropic/claude-sonnet-5.5",
      "--effort",
      "high",
    ]);
    expect(captured?.env.FX_MODEL).toBe("anthropic/claude-sonnet-5.5");
    const settings = JSON.parse(
      await fsp.readFile(path.join(home, ".fx", "settings.json"), "utf8"),
    );
    expect(settings).toEqual({
      permission: { run_command: "deny" },
      model: "anthropic/claude-sonnet-5.5",
      effort: "high",
    });
  });

  it("omits the effort flag when no effort is requested", async () => {
    let captured: Parameters<FxProcessRunner>[0] | undefined;
    await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      store: { waitForSessionDir: async () => undefined, readEventsJsonl: async () => "" },
      runProcess: async (input) => {
        captured = input;
        return { stdout: JSON.stringify({ output: "ok", exit_code: 0 }), stderr: "", exitCode: 0 };
      },
    });
    expect(captured?.args).toEqual(["ask", "--json", "--auto"]);
  });

  it("validates reasoning efforts fx would otherwise drop silently", () => {
    expect(parseFxReasoningEffort(undefined)).toBeUndefined();
    expect(parseFxReasoningEffort(" ")).toBeUndefined();
    expect(parseFxReasoningEffort("XHigh")).toBe("xhigh");
    for (const effort of FX_REASONING_EFFORTS) expect(parseFxReasoningEffort(effort)).toBe(effort);
    expect(() => parseFxReasoningEffort("ultra", "EVAL_FX_REASONING_EFFORT")).toThrow(
      /EVAL_FX_REASONING_EFFORT must be one of auto, none, minimal, low, medium, high, xhigh, max/u,
    );
  });

  it("maps dashed Anthropic versions onto gateway catalog ids", () => {
    expect(normalizeFxModel("anthropic/claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5.5");
    expect(normalizeFxModel("anthropic/claude-opus-5-5")).toBe("anthropic/claude-opus-5.5");
    expect(normalizeFxModel("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(normalizeFxModel("anthropic/claude-opus-5")).toBe("anthropic/claude-opus-5");
    expect(normalizeFxModel("anthropic/claude-sonnet-4-20250514")).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
    expect(normalizeFxModel("openai/gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
  });
});
