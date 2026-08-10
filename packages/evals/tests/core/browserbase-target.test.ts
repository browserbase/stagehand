import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const updateMock = vi.fn();
const debugMock = vi.fn();

vi.mock("../../core/runtime/coreDeps.js", () => ({
  loadBrowserbaseSdk: () =>
    class FakeBrowserbase {
      sessions = {
        create: createMock,
        update: updateMock,
        debug: debugMock,
      };
    },
}));

describe("runner-provided Browserbase target", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BROWSERBASE_API_KEY = "test-api-key";
    process.env.BROWSERBASE_PROJECT_ID = "test-project-id";
    delete process.env.BROWSERBASE_REGION;
    createMock.mockReset();
    updateMock.mockReset();
    debugMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("creates and releases a Browserbase session", async () => {
    createMock.mockResolvedValue({
      id: "session-123",
      connectUrl: "wss://connect.browserbase.test/devtools/browser/session-123",
    });
    debugMock.mockResolvedValue({
      debuggerUrl: "https://debug.browserbase.test/session-123",
    });

    const { launchRunnerProvidedBrowserbaseChrome } = await import(
      "../../core/targets/browserbase.js"
    );

    const target = await launchRunnerProvidedBrowserbaseChrome();

    expect(target.wsUrl).toBe(
      "wss://connect.browserbase.test/devtools/browser/session-123",
    );
    expect(target.sessionId).toBe("session-123");
    expect(target.sessionUrl).toBe(
      "https://www.browserbase.com/sessions/session-123",
    );
    expect(target.debugUrl).toBe("https://debug.browserbase.test/session-123");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "test-project-id",
        browserSettings: {
          viewport: { width: 1288, height: 711 },
        },
      }),
    );

    await target.cleanup();

    expect(updateMock).toHaveBeenCalledWith("session-123", {
      status: "REQUEST_RELEASE",
      projectId: "test-project-id",
    });
  });

  it("falls back to BB_* credentials when Browserbase env vars are empty", async () => {
    process.env.BROWSERBASE_API_KEY = "";
    process.env.BROWSERBASE_PROJECT_ID = "";
    process.env.BB_API_KEY = "fallback-api-key";
    process.env.BB_PROJECT_ID = "fallback-project-id";
    createMock.mockResolvedValue({
      id: "session-456",
      connectUrl: "wss://connect.browserbase.test/devtools/browser/session-456",
    });

    const { launchRunnerProvidedBrowserbaseChrome } = await import(
      "../../core/targets/browserbase.js"
    );

    const target = await launchRunnerProvidedBrowserbaseChrome();

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "fallback-project-id",
      }),
    );

    await target.cleanup();
  });
});
