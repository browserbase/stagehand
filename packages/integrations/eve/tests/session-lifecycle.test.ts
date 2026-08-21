import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  create: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  browserbase: { launch: mocks.launch, connect: mocks.connect },
  localBrowser: { launch: vi.fn() },
  Stagehand: { create: mocks.create },
}));

vi.mock("@browserbasehq/stagehand-integrations/facade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@browserbasehq/stagehand-integrations/facade")>()),
  releaseBrowserbaseSession: mocks.release,
  stagehandFacadeConfigFromEnv: () => ({
    browser: { type: "browserbase", launchOptions: { apiKey: "test-api-key" } },
    stagehand: {},
  }),
}));

describe("Eve facade session lifecycle", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    vi.resetModules();
    mocks.launch.mockReset();
    mocks.connect.mockReset();
    mocks.create.mockReset();
    mocks.release.mockReset();
    mocks.release.mockResolvedValue(undefined);
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "stagehand-eve-session-test-"));
    process.env.STAGEHAND_EVE_SESSION_FILE = path.join(temporaryDirectory, "session.json");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STAGEHAND_EVE_SESSION_FILE;
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  it("releases an explicit browser close and creates fresh resources on the next call", async () => {
    const first = createResources("session-one");
    const second = createResources("session-two");
    mocks.launch.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    mocks.create.mockResolvedValueOnce(first.stagehand).mockResolvedValueOnce(second.stagehand);
    const { getFacadeTools } = await import("../src/session.js");

    const firstTools = await getFacadeTools();
    await expect(firstTools.run("await browser.close();")).resolves.toBe("closed");

    expect(first.stagehand.close).toHaveBeenCalledOnce();
    expect(first.browser.close).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      baseUrl: undefined,
      sessionId: "session-one",
    });
    expect(existsSync(process.env.STAGEHAND_EVE_SESSION_FILE!)).toBe(false);

    const secondTools = await getFacadeTools();
    expect(secondTools).not.toBe(firstTools);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(existsSync(process.env.STAGEHAND_EVE_SESSION_FILE!)).toBe(true);
  });

  it("surfaces a failed release instead of reporting close success", async () => {
    const resources = createResources("session-failed-release");
    mocks.launch.mockResolvedValueOnce(resources.browser);
    mocks.create.mockResolvedValueOnce(resources.stagehand);
    mocks.release.mockRejectedValueOnce(new Error("release failed"));
    const { getFacadeTools } = await import("../src/session.js");
    const { BrowserbaseSessionReleaseError } =
      await import("@browserbasehq/stagehand-integrations/facade");

    const tools = await getFacadeTools();
    await expect(tools.run("await browser.close();")).rejects.toBeInstanceOf(
      BrowserbaseSessionReleaseError,
    );
  });

  it("surfaces a browser close failure even when Browserbase release succeeds", async () => {
    const resources = createResources("session-browser-close-failed");
    resources.browser.close.mockRejectedValueOnce(new Error("browser close failed"));
    mocks.launch.mockResolvedValueOnce(resources.browser);
    mocks.create.mockResolvedValueOnce(resources.stagehand);
    const { getFacadeTools } = await import("../src/session.js");

    const tools = await getFacadeTools();
    await expect(tools.run("await browser.close();")).rejects.toThrow("browser close failed");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("releases a persisted session when Stagehand initialization cleanup fails", async () => {
    const resources = createResources("session-init-failed");
    resources.browser.close.mockRejectedValueOnce(new Error("browser close failed"));
    mocks.launch.mockResolvedValueOnce(resources.browser);
    mocks.create.mockRejectedValueOnce(new Error("Stagehand init failed"));
    const { getFacadeTools } = await import("../src/session.js");

    await expect(getFacadeTools()).rejects.toThrow("Stagehand init failed");
    expect(resources.browser.close).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      baseUrl: undefined,
      sessionId: "session-init-failed",
    });
    expect(existsSync(process.env.STAGEHAND_EVE_SESSION_FILE!)).toBe(false);
  });
});

function createResources(sessionId: string) {
  const page = { pageId: `page-${sessionId}` };
  const browser = {
    closed: false,
    sessionId,
    context: { pages: vi.fn(async () => [page]) },
    close: vi.fn(async function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
  const stagehand = {
    browser: { context: { activePage: vi.fn(async () => page) } },
    close: vi.fn(async () => undefined),
    experimentalBatch: vi.fn(async () => ({
      __stagehandPlaywrightCompat: true,
      value: "closed",
      closeRequested: true,
    })),
  };
  return { browser, stagehand };
}
