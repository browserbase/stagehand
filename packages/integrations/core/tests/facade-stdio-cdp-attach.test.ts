import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  create: vi.fn(),
  setRequestHandler: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  browserbase: { launch: mocks.launch },
  localBrowser: { launch: mocks.launch, connect: mocks.connect },
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
    browser: { type: "cdp", connectOptions: { cdpUrl: "ws://127.0.0.1:9222/devtools/browser/x" } },
    stagehand: {},
  }),
}));
vi.mock("../src/facade/tools.js", () => ({
  StagehandFacadeTools: class {
    async snapshot() {
      return "captured";
    }
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it("attaches to the host's browser instead of launching one", async () => {
  mocks.connect.mockResolvedValue({ provider: "local", close: vi.fn() });
  mocks.create.mockResolvedValue({});
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);
  await import("../src/facade/stdio-server.js");
  const handler = mocks.setRequestHandler.mock.calls.at(-1)?.[1] as (
    request: { params: { name: string; arguments: object } },
    extra: { requestId: string },
  ) => Promise<unknown>;

  await handler({ params: { name: "snapshot", arguments: {} } }, { requestId: "snapshot-1" });

  expect(mocks.connect).toHaveBeenCalledWith({ cdpUrl: "ws://127.0.0.1:9222/devtools/browser/x" });
  expect(mocks.launch).not.toHaveBeenCalled();
});
