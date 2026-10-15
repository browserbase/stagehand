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
  const browser = { closed: false, origin: "connected", close: vi.fn(async () => undefined) };
  const stagehand = { close: vi.fn(async () => undefined) };
  mocks.connect.mockResolvedValue(browser);
  mocks.create.mockResolvedValue(stagehand);
  const tools: Array<{ name: string; execute: (id: string, params: object) => Promise<unknown> }> =
    [];
  const handlers: Record<string, () => Promise<void>> = {};
  const { default: stagehandExtension } = await import("../extensions/stagehand.js");
  stagehandExtension({
    registerTool: (tool: never) => tools.push(tool),
    on: (event: string, handler: () => Promise<void>) => (handlers[event] = handler),
  } as never);

  await tools.find((tool) => tool.name === "snapshot")!.execute("call-1", {});

  expect(mocks.connect).toHaveBeenCalledWith({ cdpUrl: "ws://127.0.0.1:9222/devtools/browser/x" });
  expect(mocks.launch).not.toHaveBeenCalled();

  // Shutdown detaches; the attached browser belongs to its host.
  await handlers.session_shutdown!();
  expect(stagehand.close).toHaveBeenCalledTimes(1);
  expect(browser.close).not.toHaveBeenCalled();
});
