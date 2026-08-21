import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  browserbase: { launch: mocks.launch },
  localBrowser: { launch: vi.fn() },
  Stagehand: { create: mocks.create },
}));

vi.mock("@browserbasehq/stagehand-integrations/facade", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@browserbasehq/stagehand-integrations/facade")>();
  return {
    ...original,
    stagehandFacadeConfigFromEnv: () => ({
      browser: { type: "browserbase", launchOptions: { apiKey: "test-key" } },
      stagehand: {},
    }),
    releaseBrowserbaseSession: async (session: { sessionId: string }) => {
      const response = await fetch(`https://api.browserbase.com/v1/sessions/${session.sessionId}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to release the Browserbase session.");
    },
    StagehandFacadeTools: class {
      constructor(
        _stagehand: unknown,
        private readonly lifecycle: { close(): Promise<void> },
      ) {}

      async run(): Promise<string> {
        await this.lifecycle.close();
        return "closed";
      }

      async runActions(): Promise<object> {
        return {};
      }

      async snapshot(): Promise<string> {
        return "snapshot";
      }

      async screenshot(): Promise<{ data: string; mimeType: "image/png" }> {
        return { data: "", mimeType: "image/png" };
      }
    },
  };
});

type RegisteredTool = {
  name: string;
  execute(toolCallId: string, params: unknown): Promise<unknown>;
};

describe("pi stagehand lifecycle", () => {
  beforeEach(() => {
    mocks.launch.mockReset();
    mocks.create.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("surfaces cleanup failures and releases them before launching fresh resources", async () => {
    const browser = {
      closed: false,
      sessionId: "session-one",
      close: vi.fn(async () => {
        throw new Error("browser close failed");
      }),
    };
    const freshBrowser = {
      closed: false,
      sessionId: "session-two",
      close: vi.fn(async () => undefined),
    };
    mocks.launch.mockResolvedValueOnce(browser).mockResolvedValueOnce(freshBrowser);
    mocks.create
      .mockResolvedValueOnce({ close: vi.fn(async () => undefined) })
      .mockResolvedValueOnce({ close: vi.fn(async () => undefined) });
    const release = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", release);
    const { tools } = await registerExtension();
    const run = tools.find((tool) => tool.name === "run");

    await expect(run?.execute("call-1", { code: "await browser.close();" })).rejects.toThrow(
      "browser close failed",
    );
    const snapshot = tools.find((tool) => tool.name === "snapshot");
    await expect(snapshot?.execute("call-2", {})).rejects.toThrow(
      "Failed to release the Browserbase session.",
    );
    expect(mocks.launch).toHaveBeenCalledOnce();

    await expect(snapshot?.execute("call-3", {})).resolves.toBeDefined();
    expect(release).toHaveBeenCalledTimes(2);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it("keeps session shutdown cleanup best-effort", async () => {
    const browser = {
      closed: false,
      sessionId: "session-shutdown",
      close: vi.fn(async () => {
        throw new Error("browser close failed");
      }),
    };
    mocks.launch.mockResolvedValueOnce(browser);
    mocks.create.mockResolvedValueOnce({
      close: vi.fn(async () => {
        throw new Error("stagehand close failed");
      }),
    });
    const release = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", release);
    const { tools, shutdown } = await registerExtension();
    const snapshot = tools.find((tool) => tool.name === "snapshot");
    await snapshot?.execute("call-1", {});

    await expect(shutdown?.()).resolves.toBeUndefined();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases the Browserbase session when Stagehand initialization cleanup fails", async () => {
    const browser = {
      closed: false,
      sessionId: "session-init-failed",
      close: vi.fn(async () => {
        throw new Error("browser close failed");
      }),
    };
    const freshBrowser = {
      closed: false,
      sessionId: "session-after-init-failure",
      close: vi.fn(async () => undefined),
    };
    mocks.launch.mockResolvedValueOnce(browser).mockResolvedValueOnce(freshBrowser);
    mocks.create
      .mockRejectedValueOnce(new Error("Stagehand init failed"))
      .mockResolvedValueOnce({ close: vi.fn(async () => undefined) });
    const release = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", release);
    const { tools } = await registerExtension();
    const snapshot = tools.find((tool) => tool.name === "snapshot");

    await expect(snapshot?.execute("call-1", {})).rejects.toThrow(
      "Stagehand initialization failed and browser cleanup also failed.",
    );
    expect(browser.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();

    await expect(snapshot?.execute("call-2", {})).resolves.toBeDefined();
    expect(release).toHaveBeenCalledTimes(2);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });
});

async function registerExtension(): Promise<{
  tools: RegisteredTool[];
  shutdown: (() => Promise<void>) | undefined;
}> {
  const { default: stagehandExtension } = await import("../extensions/stagehand.js");
  const tools: RegisteredTool[] = [];
  let shutdown: (() => Promise<void>) | undefined;
  stagehandExtension({
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    on: (event: string, handler: () => Promise<void>) => {
      if (event === "session_shutdown") shutdown = handler;
    },
  } as never);
  return { tools, shutdown };
}
