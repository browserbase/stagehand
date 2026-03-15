import { beforeEach, describe, expect, it, vi } from "vitest";

const browserStartMock = vi.fn();
const browserStopMock = vi.fn();
const browserMetadata = {
  id: "browser-1",
  type: "local" as const,
  cdpUrl: "ws://127.0.0.1:9222/devtools/browser/test",
  browserUrl: "http://127.0.0.1:9222",
  launched: true,
  headless: true,
};

const createdServers: Array<{
  stop: ReturnType<typeof vi.fn>;
  getName: ReturnType<typeof vi.fn>;
}> = [];

const agentSessionInstances: Array<{
  harnessType: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  attachMCPServer: ReturnType<typeof vi.fn>;
  addUserMessage: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../../lib/browser/session.js", () => ({
  BrowserSession: class {
    async start() {
      await browserStartMock();
    }

    async stop() {
      await browserStopMock();
    }

    getMetadata() {
      return browserMetadata;
    }
  },
}));

vi.mock("../../lib/mcp/index.js", () => ({
  createMCPServer: vi.fn((options: { type: string }) => {
    const server = {
      stop: vi.fn(async () => {}),
      getName: vi.fn(() => options.type),
    };
    createdServers.push(server);
    return server;
  }),
}));

vi.mock("../../lib/agents/session.js", () => ({
  AgentSession: class {
    readonly harnessType: string;
    readonly start = vi.fn(async () => {});
    readonly stop = vi.fn(async () => {});
    readonly attachMCPServer = vi.fn();
    readonly addUserMessage = vi.fn(async (task: string) => {
      if (this.harnessType === "codex") {
        throw new Error("codex failed");
      }

      return {
        sessionId: `${this.harnessType}-session`,
        message: {
          content: `${this.harnessType}:${task}`,
        },
        usage: {
          inputTokens: 11,
        },
      };
    });

    constructor(options: { harness: { type: string } }) {
      this.harnessType = options.harness.type;
      agentSessionInstances.push(this);
    }
  },
}));

import { MultiAgentDriver } from "../../lib/runtime/driver.js";

describe("MultiAgentDriver", () => {
  beforeEach(() => {
    browserStartMock.mockReset();
    browserStopMock.mockReset();
    createdServers.length = 0;
    agentSessionInstances.length = 0;
  });

  it("fans out one task across agent sessions and cleans up shared resources", async () => {
    const driver = new MultiAgentDriver({
      task: "open example.com",
      agents: [{ type: "claude-code" }, { type: "codex" }],
      mcpServers: [{ type: "playwright" }, { type: "chrome-devtools" }],
    });

    const result = await driver.run();

    expect(browserStartMock).toHaveBeenCalledTimes(1);
    expect(browserStopMock).toHaveBeenCalledTimes(1);
    expect(result.browser).toEqual(browserMetadata);
    expect(result.agents).toEqual([
      {
        harness: "claude-code",
        sessionId: "claude-code-session",
        content: "claude-code:open example.com",
        raw: undefined,
        usage: {
          inputTokens: 11,
        },
      },
      {
        harness: "codex",
        content: "",
        error: "codex failed",
        raw: expect.any(Error),
      },
    ]);

    expect(createdServers).toHaveLength(2);
    for (const server of createdServers) {
      expect(server.stop).toHaveBeenCalledTimes(1);
    }

    expect(agentSessionInstances).toHaveLength(2);
    for (const session of agentSessionInstances) {
      expect(session.start).toHaveBeenCalledTimes(1);
      expect(session.stop).toHaveBeenCalledTimes(1);
      expect(session.attachMCPServer).toHaveBeenCalledTimes(2);
      expect(session.addUserMessage).toHaveBeenCalledWith("open example.com");
    }
  });
});
