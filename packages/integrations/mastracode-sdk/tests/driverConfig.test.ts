import { describe, expect, it } from "vitest";
import {
  MASTRACODE_DISABLED_TOOLS,
  MASTRACODE_PROMPT_DENIED_TOOLS,
  MASTRACODE_PROTOCOL_VERSION,
  buildDenyPermissionRules,
  buildMastraCodeConfig,
  defaultModeInstructions,
  sideModelIdFor,
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
    expect(config.initialState).toMatchObject({ yolo: true, thinkingLevel: "high" });
    expect(
      buildMastraCodeConfig({ ...request, thinkingLevel: undefined }).initialState,
    ).not.toHaveProperty("thinkingLevel");
  });

  it("denies every non-facade tool so mastracode's prompt stops describing it", () => {
    const initialState = buildMastraCodeConfig(request).initialState as {
      permissionRules: { categories: Record<string, string>; tools: Record<string, string> };
    };
    const rules = initialState.permissionRules;
    expect(rules.categories).toEqual({});
    for (const name of [
      "ask_user",
      "execute_command",
      "view",
      "write_file",
      "string_replace_lsp",
      "search_content",
      "find_files",
      "task_write",
      "task_update",
      "task_check",
      "task_complete",
      "submit_plan",
      "subagent",
      "web_search",
      "web_extract",
      "recall",
      "ask_memory",
      "knowledge_search",
      ...MASTRACODE_PROMPT_DENIED_TOOLS,
      ...MASTRACODE_DISABLED_TOOLS,
    ]) {
      expect(rules.tools[name], name).toBe("deny");
    }
    for (const name of request.facadeToolNames) expect(rules.tools).not.toHaveProperty(name);
    expect(Object.values(rules.tools).every((policy) => policy === "deny")).toBe(true);
  });

  it("never denies a facade tool, even one sharing a mastracode tool name", () => {
    const rules = buildDenyPermissionRules(["view", "stagehand_run"]);
    expect(rules.tools).not.toHaveProperty("view");
    expect(rules.tools).not.toHaveProperty("stagehand_run");
    expect(rules.tools.execute_command).toBe("deny");
  });

  it("pins titles and observational memory to the eval model, not google/gemini", () => {
    expect(buildMastraCodeConfig(request).initialState).toMatchObject({
      observerModelId: "anthropic/claude-sonnet-4-6",
      reflectorModelId: "anthropic/claude-sonnet-4-6",
    });
    expect(
      buildMastraCodeConfig({ ...request, sideModelId: "anthropic/claude-haiku-4-5" }).initialState,
    ).toMatchObject({
      observerModelId: "anthropic/claude-haiku-4-5",
      reflectorModelId: "anthropic/claude-haiku-4-5",
    });
    expect(sideModelIdFor({ ...request, sideModelId: "  " })).toBe(request.modelId);
  });

  it("tells the model there is no user to ask and that coding guidance does not apply", () => {
    const text = defaultModeInstructions(request.facadeToolNames);
    expect(text).toContain("There is no user to ask");
    expect(text).toContain("do not apply to this session");
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
    [JSON.stringify({ ...request, startupTimeoutMs: 0 }), "startupTimeoutMs"],
    [JSON.stringify({ ...request, sideModelId: 5 }), "sideModelId"],
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
