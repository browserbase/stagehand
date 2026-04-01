import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCAL_CONFIG,
  resolveLocalStrategy,
} from "../src/local-strategy";

const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

describe("resolveLocalStrategy", () => {
  it("uses an isolated browser by default", async () => {
    const discoverLocalCdp = vi.fn().mockResolvedValue(null);
    const resolveWsTarget = vi.fn();

    const result = await resolveLocalStrategy({
      localConfig: DEFAULT_LOCAL_CONFIG,
      headless: true,
      defaultViewport: DEFAULT_VIEWPORT,
      discoverLocalCdp,
      resolveWsTarget,
    });

    expect(result.localLaunchOptions).toEqual({
      headless: true,
      viewport: DEFAULT_VIEWPORT,
    });
    expect(result.localInfo).toEqual({ localSource: "isolated" });
    expect(discoverLocalCdp).not.toHaveBeenCalled();
    expect(resolveWsTarget).not.toHaveBeenCalled();
  });

  it("auto-connects to a discovered local browser when requested", async () => {
    const discoverLocalCdp = vi.fn().mockResolvedValue({
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc123",
      source: "port 9222",
    });
    const resolveWsTarget = vi.fn();

    const result = await resolveLocalStrategy({
      localConfig: { strategy: "auto" },
      headless: true,
      defaultViewport: DEFAULT_VIEWPORT,
      discoverLocalCdp,
      resolveWsTarget,
    });

    expect(result.localLaunchOptions).toEqual({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc123",
    });
    expect(result.localInfo).toEqual({
      localSource: "attached-existing",
      resolvedCdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc123",
    });
    expect(discoverLocalCdp).toHaveBeenCalledTimes(1);
    expect(resolveWsTarget).not.toHaveBeenCalled();
  });

  it("falls back to isolated launch when auto-connect finds nothing", async () => {
    const discoverLocalCdp = vi.fn().mockResolvedValue(null);
    const resolveWsTarget = vi.fn();

    const result = await resolveLocalStrategy({
      localConfig: { strategy: "auto" },
      headless: false,
      defaultViewport: DEFAULT_VIEWPORT,
      discoverLocalCdp,
      resolveWsTarget,
    });

    expect(result.localLaunchOptions).toEqual({
      headless: false,
      viewport: DEFAULT_VIEWPORT,
    });
    expect(result.localInfo).toEqual({
      localSource: "isolated-fallback",
      fallbackReason: "no debuggable local browser found",
    });
    expect(discoverLocalCdp).toHaveBeenCalledTimes(1);
    expect(resolveWsTarget).not.toHaveBeenCalled();
  });

  it("resolves an explicit CDP target without discovery", async () => {
    const discoverLocalCdp = vi.fn();
    const resolveWsTarget = vi
      .fn()
      .mockResolvedValue("ws://127.0.0.1:9229/devtools/browser/xyz789");

    const result = await resolveLocalStrategy({
      localConfig: { strategy: "cdp", cdpTarget: "9229" },
      headless: true,
      defaultViewport: DEFAULT_VIEWPORT,
      discoverLocalCdp,
      resolveWsTarget,
    });

    expect(result.localLaunchOptions).toEqual({
      cdpUrl: "ws://127.0.0.1:9229/devtools/browser/xyz789",
    });
    expect(result.localInfo).toEqual({
      localSource: "attached-explicit",
      resolvedCdpUrl: "ws://127.0.0.1:9229/devtools/browser/xyz789",
    });
    expect(discoverLocalCdp).not.toHaveBeenCalled();
    expect(resolveWsTarget).toHaveBeenCalledWith("9229");
  });
});
