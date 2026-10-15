import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  browserbase: { launch: mocks.launch },
  localBrowser: { launch: mocks.launch, connect: mocks.connect },
  Stagehand: { create: mocks.create },
}));
vi.mock("@browserbasehq/stagehand-integrations/facade", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  StagehandFacadeTools: class {
    async snapshot() {
      return "captured";
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

it("attaches to the host's browser instead of launching one", async () => {
  vi.stubEnv("STAGEHAND_BROWSER", "cdp");
  vi.stubEnv("STAGEHAND_CDP_URL", "ws://127.0.0.1:9222/devtools/browser/x");
  mocks.connect.mockResolvedValue({ closed: false, close: vi.fn() });
  mocks.create.mockResolvedValue({ close: vi.fn() });
  const tools: Array<{ name: string; execute: (id: string, params: object) => Promise<unknown> }> =
    [];
  const { default: stagehandExtension } = await import("../extensions/stagehand.js");
  stagehandExtension({
    registerTool: (tool: never) => tools.push(tool),
    on: () => undefined,
  } as never);

  await tools.find((tool) => tool.name === "snapshot")!.execute("call-1", {});

  expect(mocks.connect).toHaveBeenCalledWith({ cdpUrl: "ws://127.0.0.1:9222/devtools/browser/x" });
  expect(mocks.launch).not.toHaveBeenCalled();
});
