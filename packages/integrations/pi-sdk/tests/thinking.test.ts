import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PI_MCP_EXPOSURE,
  DEFAULT_PI_THINKING_LEVEL,
  runPiSession,
} from "../src/session.js";

const pi = vi.hoisted(() => ({
  resolveCliModel: vi.fn(),
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(),
  createMcpExtension: vi.fn((options?: { loadConfig?: () => unknown }) => {
    void options;
    return () => {};
  }),
  bindExtensions: vi.fn(async () => {}),
  resourceLoaderOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: async () => ({}) },
  resolveCliModel: pi.resolveCliModel,
  createAgentSession: pi.createAgentSession,
  SettingsManager: { inMemory: (settings: unknown) => settings },
  SessionManager: { inMemory: () => ({}) },
  DefaultResourceLoader: class {
    constructor(options: Record<string, unknown>) {
      pi.resourceLoaderOptions = options;
      pi.DefaultResourceLoader(options);
    }
    async reload() {}
  },
  createMcpExtension: pi.createMcpExtension,
}));

describe("pi thinking precedence through the SDK loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pi.resourceLoaderOptions = undefined;
    pi.createAgentSession.mockResolvedValue({
      session: {
        agent: { state: {} },
        subscribe: () => () => {},
        prompt: async () => {},
        abort: async () => {},
        dispose: () => {},
        bindExtensions: pi.bindExtensions,
      },
    });
  });

  it.each([
    { explicit: undefined, resolved: "high", expected: "high" },
    { explicit: "off", resolved: "high", expected: "off" },
    { explicit: undefined, resolved: undefined, expected: DEFAULT_PI_THINKING_LEVEL },
  ])(
    "uses explicit=$explicit, resolved=$resolved => $expected",
    async ({ explicit, resolved, expected }) => {
      const model = { id: "fixture", provider: "openai" };
      pi.resolveCliModel.mockReturnValue({ model, thinkingLevel: resolved });
      const cliModel = `openai/fixture${resolved ? `:${resolved}` : ""}`;
      // Exercise runPiSession -> loadPiSdk -> the provider's model resolver; an
      // injected PiSdk would bypass the point where model suffixes are resolved.
      const result = await runPiSession({
        model: cliModel,
        prompt: "Fixture task",
        session: { ...(explicit !== undefined && { thinkingLevel: explicit }) },
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });
      expect(result.status).toBe("completed");
      expect(pi.resolveCliModel).toHaveBeenCalledWith({ cliModel, modelRuntime: {} });
      expect(pi.createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model,
          thinkingLevel: expected,
          noTools: "builtin",
          settingsManager: expect.objectContaining({
            compaction: { enabled: false },
          }),
        }),
      );
      expect(pi.createAgentSession.mock.calls[0][0]).not.toHaveProperty("tools");
      expect(pi.createAgentSession.mock.calls[0][0]).not.toHaveProperty("excludeTools");
      expect(pi.createMcpExtension).not.toHaveBeenCalled();
      expect(pi.bindExtensions).toHaveBeenCalledWith({});
      expect(pi.resourceLoaderOptions).toMatchObject({
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [],
      });
    },
  );

  it("registers eval MCP servers with direct exposure and skips Pi's codemode tool", async () => {
    const model = { id: "fixture", provider: "openai" };
    pi.resolveCliModel.mockReturnValue({ model });
    const registerMcpServer = vi.fn();
    await runPiSession({
      model: "openai/fixture",
      prompt: "Fixture task",
      session: {
        mcpServers: {
          stagehand: { command: "node", args: ["server.mjs"], cwd: "/tmp/mcp" },
        },
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    expect(pi.createMcpExtension).toHaveBeenCalledWith({
      loadConfig: expect.any(Function),
    });
    const mcpOptions = pi.createMcpExtension.mock.calls.at(0)?.at(0);
    expect(mcpOptions?.loadConfig?.()).toEqual({
      servers: [],
      errors: [],
    });
    const factories = pi.resourceLoaderOptions?.extensionFactories as Array<
      (api: { registerMcpServer: typeof registerMcpServer }) => void
    >;
    expect(factories).toHaveLength(2);
    factories[1]({ registerMcpServer });
    expect(registerMcpServer).toHaveBeenCalledWith("stagehand", {
      command: "node",
      args: ["server.mjs"],
      cwd: "/tmp/mcp",
      exposure: DEFAULT_PI_MCP_EXPOSURE,
      description: "Stagehand browser tools",
    });
  });
});
