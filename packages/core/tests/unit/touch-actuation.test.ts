import { describe, expect, it } from "vitest";
import { V3 } from "../../lib/v3/v3.js";
import type { V3Options } from "../../lib/v3/types/public/options.js";

// `usesTouch` is explicit opt-in via the `useTouch` option — nothing is derived
// from the session, so constructing V3 is enough to test it. That is the point of
// the design: the answer is known before the first action, cannot drift mid-run,
// and never surprises a caller who didn't ask for touch.
const v3 = (opts: Partial<V3Options>) =>
  new V3({ env: "LOCAL", disablePino: true, ...opts } as V3Options);

describe("touch actuation resolution", () => {
  it("uses touch when useTouch is true", () => {
    expect(v3({ useTouch: true }).usesTouch).toBe(true);
  });

  it("keeps mouse when useTouch is false", () => {
    expect(v3({ useTouch: false }).usesTouch).toBe(false);
  });

  it("keeps mouse when useTouch is omitted", () => {
    expect(v3({}).usesTouch).toBe(false);
  });

  describe("nothing is derived from the session", () => {
    it("a Browserbase os:'mobile' session still needs the explicit flag", () => {
      const mobile = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionCreateParams: {
          projectId: "bb-project",
          browserSettings: { os: "mobile" },
        },
      });
      expect(mobile.usesTouch).toBe(false);
    });

    it("a local hasTouch launch still needs the explicit flag", () => {
      expect(
        v3({ localBrowserLaunchOptions: { hasTouch: true } }).usesTouch,
      ).toBe(false);
    });

    it("useTouch works the same on a resumed Browserbase session", () => {
      const resumed = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionID: "existing-session",
        useTouch: true,
      });
      expect(resumed.usesTouch).toBe(true);
    });
  });

  it("is stable across repeated reads", () => {
    const instance = v3({ useTouch: true });
    expect([
      instance.usesTouch,
      instance.usesTouch,
      instance.usesTouch,
    ]).toEqual([true, true, true]);
  });
});
