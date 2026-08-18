import { describe, expect, it, vi } from "vitest";
import { processCoordinates } from "../../lib/v3/agent/utils/coordinateNormalization.js";
import { V3 } from "../../lib/v3/v3.js";

function viewportHarness({
  viewport,
  pageViewport,
  probeError,
}: {
  viewport?: { width: number; height: number };
  pageViewport?: { width: number; height: number };
  probeError?: Error;
}) {
  const evaluate = vi.fn(async () => {
    if (probeError) throw probeError;
    return pageViewport;
  });
  const awaitActivePage = vi.fn(async () => ({
    mainFrame: () => ({ evaluate }),
  }));
  const v3 = Object.create(V3.prototype) as V3;
  const internals = v3 as unknown as {
    opts: unknown;
    ctx: unknown;
  };
  internals.opts = {
    env: "BROWSERBASE",
    browserbaseSessionCreateParams: {
      browserSettings: { viewport },
    },
  };
  internals.ctx = { awaitActivePage };

  return { v3, awaitActivePage, evaluate };
}

describe("viewport resolution", () => {
  it("uses an explicitly configured viewport without probing the page", async () => {
    const { v3, awaitActivePage } = viewportHarness({
      viewport: { width: 430, height: 932 },
    });

    await expect(v3.resolveViewport()).resolves.toEqual({
      width: 430,
      height: 932,
    });
    expect(v3.hasConfiguredViewport).toBe(true);
    expect(awaitActivePage).not.toHaveBeenCalled();
  });

  it("probes the page when no viewport is configured", async () => {
    const { v3, awaitActivePage } = viewportHarness({
      pageViewport: { width: 384, height: 696 },
    });

    await expect(v3.resolveViewport()).resolves.toEqual({
      width: 384,
      height: 696,
    });
    expect(v3.hasConfiguredViewport).toBe(false);
    expect(awaitActivePage).toHaveBeenCalledOnce();
  });

  it("uses the default when the page viewport is unavailable", async () => {
    const { v3 } = viewportHarness({ probeError: new Error("unavailable") });

    await expect(v3.resolveViewport()).resolves.toEqual({
      width: 1288,
      height: 711,
    });
  });
});

describe("hybrid coordinate normalization", () => {
  it("normalizes Google coordinates with the shared viewport resolver", async () => {
    const resolveViewport = vi.fn(async () => ({ width: 384, height: 696 }));
    const v3 = { resolveViewport } as unknown as V3;

    await expect(processCoordinates(500, 500, "google", v3)).resolves.toEqual({
      x: 192,
      y: 348,
    });
    expect(resolveViewport).toHaveBeenCalledOnce();
  });
});
