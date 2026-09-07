import { describe, expect, it, vi } from "vitest";
import type { ClaudeCuaSessionEvent } from "@browserbasehq/stagehand-integrations-claude-cua-sdk";
import { claudeCuaAdapter } from "../../framework/harnesses/claudeCuaAdapter.js";
import {
  CLAUDE_CUA_CAPABLE_MODELS,
  resolveClaudeCuaThinking,
  assertClaudeCuaModel,
} from "../../framework/claudeCuaRunner.js";

const taskSpec = { id: "t1", instruction: "Find the price", initUrl: "https://example.com" };
const png = Buffer.from("PNG").toString("base64");

const events: ClaudeCuaSessionEvent[] = [
  {
    type: "assistant",
    turn: 1,
    content: [
      { type: "thinking", thinking: "I should open the page." },
      { type: "text", text: "Opening it." },
      { type: "tool_use", id: "tu_1", name: "navigate", input: { url: "https://example.com" } },
      { type: "tool_use", id: "tu_2", name: "screenshot", input: {} },
    ],
    stopReason: "tool_use",
    usage: { input: 10, output: 5, cache_read: 0, cache_creation: 0 },
  },
  {
    type: "tool_use",
    turn: 1,
    id: "tu_1",
    name: "navigate",
    input: { url: "https://example.com" },
  },
  {
    type: "tool_result",
    turn: 1,
    toolUseId: "tu_1",
    name: "navigate",
    content: [
      { type: "text", text: "Navigated to https://example.com/" },
      {
        type: "browser_state",
        tabs: [{ tab_id: "p1", title: "", url: "https://example.com/", active: true }],
      },
    ],
    isError: false,
    durationMs: 5,
  },
  { type: "tool_use", turn: 1, id: "tu_2", name: "screenshot", input: {} },
  {
    type: "tool_result",
    turn: 1,
    toolUseId: "tu_2",
    name: "screenshot",
    content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png } }],
    isError: false,
    durationMs: 5,
  },
  {
    type: "assistant",
    turn: 2,
    content: [
      {
        type: "tool_use",
        id: "tu_3",
        name: "left_click",
        input: { target: { type: "ref", ref: "0-9" } },
      },
    ],
    stopReason: "tool_use",
    usage: { input: 10, output: 5, cache_read: 0, cache_creation: 0 },
  },
  {
    type: "tool_use",
    turn: 2,
    id: "tu_3",
    name: "left_click",
    input: { target: { type: "ref", ref: "0-9" } },
  },
  {
    type: "tool_result",
    turn: 2,
    toolUseId: "tu_3",
    name: "left_click",
    content: "Error: stale",
    isError: true,
    durationMs: 5,
  },
  {
    type: "assistant",
    turn: 3,
    content: [{ type: "text", text: 'EVAL_RESULT: {"success":true,"finalAnswer":"$5"}' }],
    stopReason: "end_turn",
    usage: { input: 10, output: 5, cache_read: 0, cache_creation: 0 },
  },
];

describe("claudeCuaAdapter", () => {
  it("builds one step per toolset member with reasoning, results, images and observations", () => {
    const trajectory = claudeCuaAdapter.fromHarnessResult(
      {
        events,
        stepObservations: new Map([["tu_1", { url: "https://example.com/" }]]),
        usage: { input_tokens: 30, output_tokens: 15 },
      },
      taskSpec,
    );

    expect(trajectory.steps.map((step) => step.actionName)).toEqual([
      "navigate",
      "screenshot",
      "left_click",
    ]);
    expect(trajectory.steps[0]!.reasoning).toBe("I should open the page.\nOpening it.");
    expect(trajectory.steps[0]!.actionArgs).toEqual({ url: "https://example.com" });
    expect(trajectory.steps[0]!.toolOutput).toMatchObject({ ok: true });
    expect(trajectory.steps[0]!.probeEvidence).toEqual({ url: "https://example.com/" });
    // Only the first member of a turn carries the turn's reasoning.
    expect(trajectory.steps[1]!.reasoning).toBe("");
    expect(trajectory.steps[1]!.agentEvidence.modalities).toContainEqual({
      type: "image",
      bytes: Buffer.from("PNG"),
      mediaType: "image/png",
    });
    expect(trajectory.steps[2]!.toolOutput).toEqual({
      ok: false,
      result: "Error: stale",
      error: "Error: stale",
    });
    expect(trajectory.finalAnswer).toBe('EVAL_RESULT: {"success":true,"finalAnswer":"$5"}');
    expect(trajectory.finalObservation?.screenshot).toEqual(Buffer.from("PNG"));
    expect(trajectory.usage).toMatchObject({ input_tokens: 30, output_tokens: 15 });
    expect(trajectory.status).toBe("complete");
  });

  it("prefers the runner's terminal observation and explicit final answer", () => {
    const trajectory = claudeCuaAdapter.fromHarnessResult(
      {
        events,
        finalAnswer: "$5",
        finalObservation: { screenshot: Buffer.from("FINAL") },
        status: "error",
      },
      taskSpec,
    );
    expect(trajectory.finalAnswer).toBe("$5");
    expect(trajectory.finalObservation?.screenshot).toEqual(Buffer.from("FINAL"));
    expect(trajectory.status).toBe("error");
  });
});

describe("claude_cua runner configuration", () => {
  it("defaults to adaptive thinking and honors env overrides", () => {
    expect(resolveClaudeCuaThinking({})).toEqual({ type: "adaptive", effort: "xhigh" });
    expect(resolveClaudeCuaThinking({ EVAL_CLAUDE_CUA_THINKING_EFFORT: "high" })).toEqual({
      type: "adaptive",
      effort: "high",
    });
    expect(resolveClaudeCuaThinking({ EVAL_CLAUDE_CUA_THINKING_EFFORT: "bogus" })).toEqual({
      type: "adaptive",
      effort: "xhigh",
    });
    expect(resolveClaudeCuaThinking({ EVAL_CLAUDE_CUA_THINKING_BUDGET: "2048" })).toEqual({
      type: "enabled",
      budgetTokens: 2048,
    });
    expect(resolveClaudeCuaThinking({ EVAL_CLAUDE_CUA_THINKING: "off" })).toEqual({
      type: "disabled",
    });
  });

  it("warns on unknown models without rejecting them", () => {
    const warn = vi.fn();
    expect(CLAUDE_CUA_CAPABLE_MODELS).toEqual([
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-fable-5-1",
    ]);
    expect(() => assertClaudeCuaModel("anthropic/claude-sonnet-5", { warn })).not.toThrow();
    expect(() => assertClaudeCuaModel("claude-opus-5")).not.toThrow();
    expect(() => assertClaudeCuaModel("claude-unknown", { warn })).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(() => assertClaudeCuaModel("openai/gpt-5.6-luna", { warn })).toThrow(
      /Anthropic Claude models only/,
    );
    expect(() => assertClaudeCuaModel("gpt-5.6-luna")).toThrow(/Anthropic Claude models only/);
    expect(warn).toHaveBeenCalledOnce();
  });
});
