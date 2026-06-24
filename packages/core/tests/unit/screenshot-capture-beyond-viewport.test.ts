import { describe, expect, it } from "vitest";
import {
  clipFitsViewport,
  shouldCaptureBeyondViewport,
  type ViewportMetrics,
} from "../../lib/v3/understudy/screenshotUtils.js";
import type { Page } from "../../lib/v3/understudy/page.js";

// STG-2335 (screenshot half): a `clip` whose region lies outside the current
// viewport must enable CDP captureBeyondViewport, otherwise the off-screen
// region renders blank. These cover the pure decision logic.

const viewport: ViewportMetrics = {
  scrollX: 0,
  scrollY: 0,
  width: 1280,
  height: 720,
};

describe("clipFitsViewport", () => {
  it("returns true for a clip fully inside the viewport", () => {
    expect(
      clipFitsViewport({ x: 0, y: 0, width: 700, height: 220 }, viewport),
    ).toBe(true);
  });

  it("returns false for a clip below the fold", () => {
    expect(
      clipFitsViewport({ x: 100, y: 3200, width: 600, height: 350 }, viewport),
    ).toBe(false);
  });

  it("returns false for a clip extending past the bottom edge", () => {
    expect(
      clipFitsViewport({ x: 0, y: 600, width: 200, height: 400 }, viewport),
    ).toBe(false);
  });

  it("accounts for scroll offset", () => {
    const scrolled: ViewportMetrics = { ...viewport, scrollY: 3000 };
    // Same below-the-fold clip now sits within the scrolled viewport.
    expect(
      clipFitsViewport({ x: 100, y: 3200, width: 600, height: 350 }, scrolled),
    ).toBe(true);
  });

  it("tolerates sub-pixel rounding at the edges", () => {
    expect(
      clipFitsViewport(
        { x: -0.4, y: -0.4, width: 1280.5, height: 720.5 },
        viewport,
      ),
    ).toBe(true);
  });
});

describe("shouldCaptureBeyondViewport", () => {
  const pageWith = (vp: ViewportMetrics | null): Page =>
    ({
      mainFrame: () => ({
        evaluate: async () => {
          if (!vp) throw new Error("no execution context");
          return vp;
        },
      }),
    }) as unknown as Page;

  it("is true for fullPage regardless of clip/viewport", async () => {
    expect(await shouldCaptureBeyondViewport(pageWith(viewport), undefined, true)).toBe(
      true,
    );
  });

  it("is false when there is no clip and not fullPage", async () => {
    expect(
      await shouldCaptureBeyondViewport(pageWith(viewport), undefined, false),
    ).toBe(false);
  });

  it("is false for a clip that fits the viewport", async () => {
    expect(
      await shouldCaptureBeyondViewport(
        pageWith(viewport),
        { x: 0, y: 0, width: 700, height: 220 },
        false,
      ),
    ).toBe(false);
  });

  it("is true for an off-viewport clip (the blank-screenshot trigger)", async () => {
    expect(
      await shouldCaptureBeyondViewport(
        pageWith(viewport),
        { x: 100, y: 3200, width: 600, height: 350 },
        false,
      ),
    ).toBe(true);
  });

  it("errs toward capturing beyond when the viewport can't be measured", async () => {
    expect(
      await shouldCaptureBeyondViewport(
        pageWith(null),
        { x: 0, y: 0, width: 100, height: 100 },
        false,
      ),
    ).toBe(true);
  });
});
