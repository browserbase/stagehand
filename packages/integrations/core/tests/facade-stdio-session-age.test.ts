import { afterEach, expect, it, vi } from "vitest";
import { SESSION_LOST_TELEMETRY_PREFIX, type FacadeSessionLoss } from "../src/facade/contract.js";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  create: vi.fn(),
  setRequestHandler: vi.fn(),
  onSessionLost: undefined as ((loss: FacadeSessionLoss) => void) | undefined,
}));

vi.mock("@browserbasehq/stagehand", () => ({
  browserbase: { launch: mocks.launch },
  localBrowser: { launch: mocks.launch },
  Stagehand: { create: mocks.create },
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    server = { removeRequestHandler: vi.fn(), setRequestHandler: mocks.setRequestHandler };
    registerTool = vi.fn();
    connect = vi.fn(async () => undefined);
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
vi.mock("../src/facade/config.js", () => ({
  stagehandFacadeConfigFromEnv: () => ({
    browser: { type: "browserbase", launchOptions: { timeout: 3600 } },
    stagehand: {},
  }),
}));
vi.mock("../src/facade/tools.js", () => ({
  StagehandFacadeTools: class {
    constructor(
      _stagehand: unknown,
      options: { onSessionLost: (loss: FacadeSessionLoss) => void },
    ) {
      mocks.onSessionLost = options.onSessionLost;
    }
    async snapshot() {
      vi.setSystemTime(15_000);
      mocks.onSessionLost?.({
        cause: "CDP connection closed",
        tool: "snapshot",
        at: new Date().toISOString(),
      });
      return "captured";
    }
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

it("includes browser launch and Stagehand initialization in measured session age", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(2_000);
  const browser = { provider: "browserbase", sessionId: "session-123", close: vi.fn() };
  mocks.launch.mockImplementation(async () => {
    vi.setSystemTime(7_000);
    return browser;
  });
  mocks.create.mockImplementation(async () => {
    vi.setSystemTime(11_000);
    return {};
  });
  const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);
  await import("../src/facade/stdio-server.js");
  const handler = mocks.setRequestHandler.mock.calls.at(-1)?.[1] as (
    request: {
      params: { name: string; arguments: object };
    },
    extra: { requestId: string },
  ) => Promise<unknown>;
  await handler({ params: { name: "snapshot", arguments: {} } }, { requestId: "snapshot-1" });
  const telemetry = output.mock.calls
    .map(([chunk]) => String(chunk))
    .find((line) => line.startsWith(SESSION_LOST_TELEMETRY_PREFIX));
  expect(telemetry).toBeDefined();
  expect(JSON.parse(telemetry!.slice(SESSION_LOST_TELEMETRY_PREFIX.length))).toMatchObject({
    provider: "browserbase",
    sessionId: "session-123",
    sessionAgeMs: 13_000,
    sessionTimeoutMs: 3_600_000,
  });
});
