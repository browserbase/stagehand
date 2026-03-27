import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectMock, launchMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  launchMock: vi.fn(),
}));

vi.mock("puppeteer-core", () => ({
  default: {
    connect: connectMock,
    launch: launchMock,
  },
}));

import { BrowserSession } from "../../lib/browser/session.js";

describe("BrowserSession", () => {
  beforeEach(() => {
    connectMock.mockReset();
    launchMock.mockReset();
  });

  it("derives browser metadata from a launched local browser", async () => {
    const close = vi.fn();
    launchMock.mockResolvedValue({
      wsEndpoint: () => "ws://127.0.0.1:9333/devtools/browser/local-session-id",
      close,
    });

    const session = new BrowserSession({
      type: "local",
      headless: true,
    });

    await session.start();

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(session.getMetadata()).toMatchObject({
      type: "local",
      launched: true,
      headless: true,
      cdpUrl: "ws://127.0.0.1:9333/devtools/browser/local-session-id",
      browserUrl: "http://127.0.0.1:9333",
    });

    await session.stop();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("connects to an existing CDP target and disconnects instead of closing", async () => {
    const disconnect = vi.fn();
    connectMock.mockResolvedValue({
      wsEndpoint: () =>
        "ws://127.0.0.1:9222/devtools/browser/existing-session-id",
      disconnect,
    });

    const session = new BrowserSession({
      type: "cdp",
      cdpUrl: "http://127.0.0.1:9222",
      connectTimeoutMs: 1234,
    });

    await session.start();

    expect(connectMock).toHaveBeenCalledWith({
      browserURL: "http://127.0.0.1:9222",
      protocolTimeout: 1234,
    });
    expect(session.getMetadata()).toMatchObject({
      type: "cdp",
      launched: false,
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/existing-session-id",
      browserUrl: "http://127.0.0.1:9222",
    });

    await session.stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("rejects CDP mode without a target URL", async () => {
    const session = new BrowserSession({
      type: "cdp",
      cdpUrl: "   ",
    });

    await expect(session.start()).rejects.toThrow(
      "BrowserSession configured for CDP mode without a cdpUrl.",
    );
  });
});
