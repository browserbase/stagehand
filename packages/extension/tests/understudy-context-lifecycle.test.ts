import { afterEach, describe, expect, it, vi } from "vitest";
import { CdpConnection } from "../understudy/cdp.ts";
import { BrowserContext } from "../understudy/context.ts";

function contextOptions(onConnected: () => void, onDisconnected: () => void) {
  return {
    websocketFactory: vi.fn() as never,
    blankPageUrl: "chrome-extension://stagehand/blank.html",
    fallbackLocatorScriptSource: "",
    chromeTabs: {} as never,
    logger: { debug: vi.fn(), error: vi.fn() } as never,
    onConnected,
    onDisconnected,
  };
}

describe("BrowserContext connection lifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports a successful connection and deduplicates disconnect notification", async () => {
    let transportClosed: (() => void) | undefined;
    const connection = {
      connected: true,
      onTransportClosed: vi.fn((handler: () => void) => {
        transportClosed = handler;
      }),
      close: vi.fn(async () => {}),
    };
    vi.spyOn(CdpConnection, "connect").mockResolvedValue(connection as never);
    vi.spyOn(BrowserContext.prototype, "bootstrap").mockResolvedValue();
    vi.spyOn(BrowserContext.prototype, "newPage").mockResolvedValue({} as never);
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();

    await BrowserContext.create(
      "ws://browser.example",
      contextOptions(onConnected, onDisconnected),
    );
    transportClosed?.();
    transportClosed?.();

    expect(onConnected).toHaveBeenCalledOnce();
    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it("closes and reports disconnection when bootstrap fails", async () => {
    let transportClosed: (() => void) | undefined;
    const connection = {
      connected: true,
      onTransportClosed: vi.fn((handler: () => void) => {
        transportClosed = handler;
      }),
      close: vi.fn(async () => transportClosed?.()),
    };
    vi.spyOn(CdpConnection, "connect").mockResolvedValue(connection as never);
    vi.spyOn(BrowserContext.prototype, "bootstrap").mockRejectedValue(
      new Error("bootstrap failed"),
    );
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();

    await expect(
      BrowserContext.create("ws://browser.example", contextOptions(onConnected, onDisconnected)),
    ).rejects.toThrow("bootstrap failed");

    expect(onConnected).toHaveBeenCalledOnce();
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(connection.close).toHaveBeenCalledOnce();
  });
});
