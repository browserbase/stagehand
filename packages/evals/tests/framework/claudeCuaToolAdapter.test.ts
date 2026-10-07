import { describe, expect, it } from "vitest";
import type { RunnerToolCallResult } from "../../core/contracts/tool.js";
import {
  CLAUDE_CUA_TOOL_SURFACES,
  bridgeCuaFacadeTools,
} from "../../framework/claudeCuaToolAdapter.js";
import { claudeCuaHarness } from "../../framework/benchHarness.js";
import { getCoreTool, listCoreRunnableTools, listCoreTools } from "../../core/tools/registry.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";

type BridgeCall = { name: string; args: Record<string, unknown>; timeoutMs?: number };

function fakeBridge(answer: (call: BridgeCall) => RunnerToolCallResult) {
  const calls: BridgeCall[] = [];
  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<RunnerToolCallResult> => {
    const call = { name, args, timeoutMs: options?.timeoutMs };
    calls.push(call);
    return answer(call);
  };
  return { calls, callTool };
}

const text = (value: string): RunnerToolCallResult => ({
  content: [{ type: "text", text: value }],
});

describe("claude_cua tool surface", () => {
  it("mounts only the Anthropic browser toolset surface, backed by the facade tool", () => {
    expect(CLAUDE_CUA_TOOL_SURFACES).toEqual(["anthropic_browser_toolset"]);
    expect(resolveToolSurface(claudeCuaHarness)).toBe("anthropic_browser_toolset");
    expect(() => resolveToolSurface(claudeCuaHarness, "stagehand_facade")).toThrow(
      'Harness "claude_cua" supports --tool anthropic_browser_toolset; received "stagehand_facade".',
    );
    expect(resolveStartupProfile("anthropic_browser_toolset", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("anthropic_browser_toolset", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    const tool = getCoreTool("anthropic_browser_toolset");
    expect(tool.id).toBe("anthropic_browser_toolset");
    expect(tool.surface).toBe("mcp");
    expect(listCoreTools()).toContain("anthropic_browser_toolset");
    expect(listCoreRunnableTools()).not.toContain("anthropic_browser_toolset");
  });
});

describe("bridgeCuaFacadeTools", () => {
  it("relays run code/actions, snapshot and screenshot as MCP tool calls with the harness timeout", async () => {
    const bridge = fakeBridge(({ name, args }) => {
      if (name === "snapshot") return text("[0-1] RootWebArea: Example");
      if (name === "screenshot") {
        return {
          content: [
            { type: "text", text: "Screenshot captured." },
            { type: "image", data: "UE5H", mimeType: "image/jpeg" },
          ],
        };
      }
      if (Array.isArray(args.actions))
        return text(JSON.stringify({ completed: 1, url: "https://x/" }));
      return text(JSON.stringify({ type: "value", value: { tabs: [], extra: { n: 1 } } }));
    });
    const tools = bridgeCuaFacadeTools(bridge.callTool, 1_234);

    expect(await tools.run("return 1;")).toEqual({ tabs: [], extra: { n: 1 } });
    expect(await tools.runActions([{ op: "click", id: "0-9" }])).toEqual({
      completed: 1,
      url: "https://x/",
    });
    expect(await tools.snapshot()).toBe("[0-1] RootWebArea: Example");
    expect(await tools.screenshot({ type: "png" })).toEqual({
      data: "UE5H",
      mimeType: "image/jpeg",
    });

    expect(bridge.calls).toEqual([
      { name: "run", args: { code: expect.stringContaining("return 1;") }, timeoutMs: 1_234 },
      { name: "run", args: { actions: [{ op: "click", id: "0-9" }] }, timeoutMs: 1_234 },
      { name: "snapshot", args: { includeIframes: true }, timeoutMs: 1_234 },
      { name: "screenshot", args: { type: "png" }, timeoutMs: 1_234 },
    ]);
  });

  it("preserves plain string values and returns sanitized facade errors", async () => {
    const bridge = fakeBridge(({ args }) =>
      typeof args.code === "string" && args.code.includes("fail")
        ? { content: [{ type: "text", text: 'Snapshot ID "9-9" is stale' }], isError: true }
        : text(JSON.stringify({ type: "value", value: "plain text" })),
    );
    const tools = bridgeCuaFacadeTools(bridge.callTool);
    expect(await tools.run("return 'x';")).toBe("plain text");
    await expect(tools.run("fail")).rejects.toThrow("Facade run tool failed.");
  });
});
