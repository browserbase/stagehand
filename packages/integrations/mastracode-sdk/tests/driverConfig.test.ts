import { describe, expect, it } from "vitest";
import {
  MASTRACODE_DISABLED_TOOLS,
  MASTRACODE_PROTOCOL_VERSION,
  buildMastraCodeConfig,
  parseDriverRequest,
  parseThinkingLevel,
  toolNamesFor,
  type MastracodeDriverRequest,
} from "../src/index.js";

const request: MastracodeDriverRequest = {
  version: MASTRACODE_PROTOCOL_VERSION,
  prompt: "task",
  hostInstructions: "EVAL POLICY",
  modelId: "anthropic/claude-sonnet-4-6",
  thinkingLevel: "high",
  stepBudget: 100,
  timeoutMs: 1000,
  mcpServers: { stagehand: { command: "node", args: ["bridge.mjs"], env: { PATH: "/bin" } } },
  facadeToolNames: toolNamesFor(),
  workspaceDir: "/tmp/r/workspace",
  appDataDir: "/tmp/r/appdata",
  homeDir: "/tmp/r/home",
};

describe("buildMastraCodeConfig", () => {
  it("names the facade tools the way mastracode's MCP manager exposes them", () => {
    expect(toolNamesFor()).toEqual(["stagehand_run", "stagehand_snapshot", "stagehand_screenshot"]);
    expect(toolNamesFor("pw", ["click"])).toEqual(["pw_click"]);
  });

  it("allows only the facade tools and strips every other tool source", () => {
    const config = buildMastraCodeConfig(request);
    const modes = config.modes as Array<Record<string, unknown>>;
    expect(modes).toHaveLength(1);
    expect(modes[0]).toMatchObject({
      id: "eval",
      defaultModelId: "anthropic/claude-sonnet-4-6",
      availableTools: ["stagehand_run", "stagehand_snapshot", "stagehand_screenshot"],
      metadata: { default: true },
    });
    expect(String(modes[0]?.instructions)).toContain("stagehand_run");
    expect(config.subagents).toEqual([]);
    expect(config.disabledTools).toEqual([...MASTRACODE_DISABLED_TOOLS]);
    expect(config.disabledTools).toContain("web_search");
    expect(config.mcpServers).toEqual(request.mcpServers);
    expect(config).toMatchObject({
      disableHooks: true,
      disablePlugins: true,
      disableGithubSignals: true,
      disableSettingsOmSeed: true,
      crossAgentSignals: false,
      intervalHandlers: [],
    });
  });

  it("keeps mastracode's own memory (its task-state signal requires it)", () => {
    expect(buildMastraCodeConfig(request)).not.toHaveProperty("memory");
  });

  it("confines project, home, and settings discovery to the per-task directories", () => {
    expect(buildMastraCodeConfig(request)).toMatchObject({
      cwd: "/tmp/r/workspace",
      homeDir: "/tmp/r/home",
      settingsPath: "/tmp/r/appdata/settings.json",
    });
  });

  it("passes the eval policy as host instructions and auto-approves tools", () => {
    const config = buildMastraCodeConfig(request);
    expect(config.hostInstructions).toBe("EVAL POLICY");
    expect(config.initialState).toEqual({ yolo: true, thinkingLevel: "high" });
    expect(buildMastraCodeConfig({ ...request, thinkingLevel: undefined }).initialState).toEqual({
      yolo: true,
    });
  });

  it("uses caller mode instructions when given", () => {
    const modes = buildMastraCodeConfig({ ...request, modeInstructions: "custom" }).modes as Array<
      Record<string, unknown>
    >;
    expect(modes[0]?.instructions).toBe("custom");
  });
});

describe("parseDriverRequest", () => {
  it("round-trips a valid request", () => {
    expect(parseDriverRequest(JSON.stringify(request))).toEqual(request);
  });

  it.each([
    ["not json", "not JSON"],
    [JSON.stringify({ ...request, version: 2 }), "version 1"],
    [JSON.stringify({ ...request, prompt: "" }), '"prompt"'],
    [JSON.stringify({ ...request, stepBudget: 0 }), "stepBudget"],
    [JSON.stringify({ ...request, facadeToolNames: [] }), "facadeToolNames"],
    [JSON.stringify({ ...request, mcpServers: { s: { url: "http://x" } } }), "stdio"],
    [JSON.stringify({ ...request, thinkingLevel: "extreme" }), "thinkingLevel"],
  ])("rejects %s", (text, message) => {
    expect(() => parseDriverRequest(text)).toThrow(message);
  });
});

describe("parseThinkingLevel", () => {
  it("accepts mastracode's levels case-insensitively and leaves empty unset", () => {
    expect(parseThinkingLevel(" XHigh ")).toBe("xhigh");
    expect(parseThinkingLevel("off")).toBe("off");
    expect(parseThinkingLevel("")).toBeUndefined();
    expect(parseThinkingLevel(undefined)).toBeUndefined();
  });

  it("rejects unknown levels with the allowed list", () => {
    expect(() => parseThinkingLevel("ultra", "EVAL_MASTRACODE_THINKING_LEVEL")).toThrow(
      "EVAL_MASTRACODE_THINKING_LEVEL must be one of off, low, medium, high, xhigh, max.",
    );
  });
});
