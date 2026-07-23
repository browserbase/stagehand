import { describe, expect, it } from "vitest";
import { V3 } from "../../lib/v3/v3.js";
import type { V3Options } from "../../lib/v3/types/public/options.js";

// `usesTouch` is resolved from configuration alone, so it needs no browser and no
// page state — constructing V3 is enough. That property is the point of the design:
// the answer is known before the first action and cannot drift mid-run.
const v3 = (opts: Partial<V3Options>) =>
  new V3({ env: "LOCAL", disablePino: true, ...opts } as V3Options);

describe("touch actuation resolution", () => {
  describe("derived from a Browserbase session's os", () => {
    const bb = (
      os?: "windows" | "mac" | "linux" | "mobile" | "tablet",
      extra?: Partial<V3Options>,
    ) =>
      v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionCreateParams: {
          projectId: "bb-project",
          browserSettings: os ? { os } : {},
        },
        ...extra,
      });

    it("uses touch for os: 'mobile'", () => {
      expect(bb("mobile").usesTouch).toBe(true);
    });

    it("uses touch for os: 'tablet'", () => {
      expect(bb("tablet").usesTouch).toBe(true);
    });

    it.each(["windows", "mac", "linux"] as const)(
      "keeps mouse for desktop os: '%s'",
      (os) => {
        expect(bb(os).usesTouch).toBe(false);
      },
    );

    it("keeps mouse when os is unset", () => {
      expect(bb(undefined).usesTouch).toBe(false);
    });

    it("keeps mouse when browserSettings is absent entirely", () => {
      const instance = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionCreateParams: { projectId: "bb-project" },
      });
      expect(instance.usesTouch).toBe(false);
    });
  });

  describe("derived from a local session's hasTouch", () => {
    it("uses touch when launched with hasTouch", () => {
      expect(
        v3({ localBrowserLaunchOptions: { hasTouch: true } }).usesTouch,
      ).toBe(true);
    });

    it("keeps mouse when hasTouch is false", () => {
      expect(
        v3({ localBrowserLaunchOptions: { hasTouch: false } }).usesTouch,
      ).toBe(false);
    });

    it("keeps mouse for a default local session", () => {
      expect(v3({}).usesTouch).toBe(false);
    });
  });

  describe("an explicit useTouch always wins", () => {
    it("forces touch on a desktop Browserbase session", () => {
      const instance = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        useTouch: true,
        browserbaseSessionCreateParams: {
          projectId: "bb-project",
          browserSettings: { os: "mac" },
        },
      });
      expect(instance.usesTouch).toBe(true);
    });

    it("forces mouse on a mobile Browserbase session", () => {
      const instance = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        useTouch: false,
        browserbaseSessionCreateParams: {
          projectId: "bb-project",
          browserSettings: { os: "mobile" },
        },
      });
      expect(instance.usesTouch).toBe(false);
    });

    it("is the way to opt in when resuming a session by id", () => {
      // Resuming by id means browserSettings are not present locally, so the
      // derived signal cannot see that the session is mobile.
      const resumed = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionID: "existing-session",
      });
      expect(resumed.usesTouch).toBe(false);

      const resumedWithTouch = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionID: "existing-session",
        useTouch: true,
      });
      expect(resumedWithTouch.usesTouch).toBe(true);
    });

    it("overrides hasTouch on a local session", () => {
      expect(
        v3({ useTouch: false, localBrowserLaunchOptions: { hasTouch: true } })
          .usesTouch,
      ).toBe(false);
    });
  });

  it("is stable across repeated reads", () => {
    const instance = v3({ localBrowserLaunchOptions: { hasTouch: true } });
    expect([
      instance.usesTouch,
      instance.usesTouch,
      instance.usesTouch,
    ]).toEqual([true, true, true]);
  });
});
