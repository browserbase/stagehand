import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupActiveRunResources } from "../../framework/activeRunCleanup.js";

const createMock = vi.fn();
const updateMock = vi.fn();
const debugMock = vi.fn();
const extensionCreateMock = vi.fn();
const extensionDeleteMock = vi.fn();

vi.mock("../../core/runtime/coreDeps.js", () => ({
  resolveStagehandExtensionArchivePath: () => import.meta.filename,
  loadBrowserbaseSdk: () =>
    class FakeBrowserbase {
      extensions = {
        create: extensionCreateMock,
        delete: extensionDeleteMock,
      };
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
    extensionCreateMock.mockReset();
    extensionDeleteMock.mockReset();
    extensionCreateMock.mockResolvedValue({ id: "extension-123" });
    extensionDeleteMock.mockResolvedValue(undefined);
    updateMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupActiveRunResources();
    vi.useRealTimers();
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

    const { launchRunnerProvidedBrowserbaseChrome } =
      await import("../../core/targets/browserbase.js");

    const target = await launchRunnerProvidedBrowserbaseChrome();

    expect(target.wsUrl).toBe("wss://connect.browserbase.test/devtools/browser/session-123");
    expect(target.sessionId).toBe("session-123");
    expect(target.sessionUrl).toBe("https://www.browserbase.com/sessions/session-123");
    expect(target.debugUrl).toBe("https://debug.browserbase.test/session-123");
    expect(target.extensionId).toBe("extension-123");
    expect(extensionCreateMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "test-project-id",
        extensionId: "extension-123",
        browserSettings: {
          viewport: { width: 1288, height: 711 },
        },
      }),
    );

    await target.cleanup();
    await target.cleanup();

    expect(updateMock).toHaveBeenCalledWith("session-123", {
      status: "REQUEST_RELEASE",
      projectId: "test-project-id",
    });
    expect(extensionDeleteMock).toHaveBeenCalledWith("extension-123", {
      headers: { "Content-Type": null },
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(extensionDeleteMock).toHaveBeenCalledTimes(1);
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

    const { launchRunnerProvidedBrowserbaseChrome } =
      await import("../../core/targets/browserbase.js");

    const target = await launchRunnerProvidedBrowserbaseChrome();

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "fallback-project-id",
      }),
    );

    await target.cleanup();
  });

  it("deletes the uploaded extension when session creation fails", async () => {
    createMock.mockRejectedValue(new Error("session create failed"));

    const { launchRunnerProvidedBrowserbaseChrome } =
      await import("../../core/targets/browserbase.js");

    await expect(launchRunnerProvidedBrowserbaseChrome()).rejects.toThrow(
      "Browserbase session creation failed.",
    );
    expect(extensionDeleteMock).toHaveBeenCalledWith("extension-123", {
      headers: { "Content-Type": null },
    });
  });

  it("releases a session that finishes creating after an active-run abort", async () => {
    let resolveCreate!: (value: { id: string; connectUrl: string }) => void;
    createMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { launchRunnerProvidedBrowserbaseChrome } =
      await import("../../core/targets/browserbase.js");
    const launchPromise = launchRunnerProvidedBrowserbaseChrome();
    await vi.waitFor(() => expect(createMock).toHaveBeenCalledOnce());

    const abortCleanup = cleanupActiveRunResources();
    resolveCreate({
      id: "session-late",
      connectUrl: "wss://connect.browserbase.test/devtools/browser/session-late",
    });

    const target = await launchPromise;
    await abortCleanup;
    await target.cleanup();

    expect(updateMock).toHaveBeenCalledWith("session-late", {
      status: "REQUEST_RELEASE",
      projectId: "test-project-id",
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(extensionDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("uploads once and reuses the extension across concurrent session creates", async () => {
    createMock
      .mockResolvedValueOnce({
        id: "session-a",
        connectUrl: "wss://connect.browserbase.test/devtools/browser/session-a",
      })
      .mockResolvedValueOnce({
        id: "session-b",
        connectUrl: "wss://connect.browserbase.test/devtools/browser/session-b",
      });

    const { launchRunnerProvidedBrowserbaseChrome, withBrowserbaseExtensionScope } =
      await import("../../core/targets/browserbase.js");

    await withBrowserbaseExtensionScope(async () => {
      const [first, second] = await Promise.all([
        launchRunnerProvidedBrowserbaseChrome(),
        launchRunnerProvidedBrowserbaseChrome(),
      ]);

      expect(extensionCreateMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(2);
      expect(createMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ extensionId: "extension-123" }),
      );
      expect(createMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ extensionId: "extension-123" }),
      );

      await Promise.all([first.cleanup(), second.cleanup()]);
      expect(extensionDeleteMock).not.toHaveBeenCalled();
    });

    expect(extensionDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient extension upload failure within the same run", async () => {
    extensionCreateMock
      .mockRejectedValueOnce(new Error("temporary upload failure"))
      .mockResolvedValueOnce({ id: "extension-retry" });
    createMock.mockResolvedValue({
      id: "session-retry",
      connectUrl: "wss://connect.browserbase.test/devtools/browser/session-retry",
    });

    const { launchRunnerProvidedBrowserbaseChrome, withBrowserbaseExtensionScope } =
      await import("../../core/targets/browserbase.js");

    await withBrowserbaseExtensionScope(async () => {
      await expect(launchRunnerProvidedBrowserbaseChrome()).rejects.toThrow(
        "temporary upload failure",
      );
      const target = await launchRunnerProvidedBrowserbaseChrome();
      expect(target.extensionId).toBe("extension-retry");
      await target.cleanup();
    });

    expect(extensionCreateMock).toHaveBeenCalledTimes(2);
    expect(extensionDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("does not hang scope cleanup when a session lease is not released", async () => {
    vi.useFakeTimers();
    createMock.mockResolvedValue({
      id: "session-leaked",
      connectUrl: "wss://connect.browserbase.test/devtools/browser/session-leaked",
    });

    const { launchRunnerProvidedBrowserbaseChrome, withBrowserbaseExtensionScope } =
      await import("../../core/targets/browserbase.js");
    let resolveTarget!: (
      target: Awaited<ReturnType<typeof launchRunnerProvidedBrowserbaseChrome>>,
    ) => void;
    const targetReady = new Promise<
      Awaited<ReturnType<typeof launchRunnerProvidedBrowserbaseChrome>>
    >((resolve) => {
      resolveTarget = resolve;
    });
    const scopePromise = withBrowserbaseExtensionScope(async () => {
      resolveTarget(await launchRunnerProvidedBrowserbaseChrome());
    });
    const target = await targetReady;
    await Promise.resolve();

    await vi.runAllTimersAsync();
    await scopePromise;

    expect(extensionDeleteMock).toHaveBeenCalledTimes(1);
    await target.cleanup();
  });
});
