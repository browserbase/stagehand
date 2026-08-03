import { describe, expect, it } from "vitest";
import { V3 } from "../../lib/v3/v3.js";
import type { V3Options } from "../../lib/v3/types/public/options.js";

// `usesTouch` is resolved once, before the first action, and cannot drift mid-run.
// For sessions Stagehand configures itself the answer comes from config alone —
// constructing V3 is enough to test it. For sessions whose creation config this
// process never saw (resume by id, cdpUrl attach), init probes the browser's UA
// via Browser.getVersion; those tests inject a fake connection.
const v3 = (opts: Partial<V3Options>) =>
  new V3({ env: "LOCAL", disablePino: true, ...opts } as V3Options);

// Run the init-time UA probe against a canned Browser.getVersion response.
const probe = async (instance: V3, userAgent: string | Error) => {
  (instance as unknown as { ctx: unknown }).ctx = {
    conn: {
      send: async () => {
        if (userAgent instanceof Error) throw userAgent;
        return { userAgent };
      },
    },
  };
  await (
    instance as unknown as { probeTouchFromBrowser: () => Promise<void> }
  ).probeTouchFromBrowser();
};

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

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

    it("still overrides on a session resumed by id", () => {
      // Resuming by id means browserSettings are not present locally; before
      // init's UA probe runs, the derived signal cannot see the session is
      // mobile. The explicit flag needs no probe at all.
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

  describe("probed from the browser's UA when config can't know", () => {
    const resumed = () =>
      v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionID: "existing-session",
      });

    it("recognizes a resumed mobile session", async () => {
      const instance = resumed();
      await probe(instance, MOBILE_UA);
      expect(instance.usesTouch).toBe(true);
    });

    it("keeps mouse for a resumed desktop session", async () => {
      const instance = resumed();
      await probe(instance, DESKTOP_UA);
      expect(instance.usesTouch).toBe(false);
    });

    it.each([
      ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"],
      ["iPad", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"],
    ])("recognizes an %s UA", async (_label, ua) => {
      const instance = resumed();
      await probe(instance, ua);
      expect(instance.usesTouch).toBe(true);
    });

    it("explicit useTouch beats the probe in both directions", async () => {
      const forcedMouse = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionID: "existing-session",
        useTouch: false,
      });
      await probe(forcedMouse, MOBILE_UA);
      expect(forcedMouse.usesTouch).toBe(false);

      const forcedTouch = v3({
        env: "BROWSERBASE",
        apiKey: "bb-key",
        projectId: "bb-project",
        browserbaseSessionID: "existing-session",
        useTouch: true,
      });
      await probe(forcedTouch, DESKTOP_UA);
      expect(forcedTouch.usesTouch).toBe(true);
    });

    it("falls back to config resolution when the probe fails", async () => {
      const instance = resumed();
      await probe(instance, new Error("target closed"));
      expect(instance.usesTouch).toBe(false);

      const local = v3({ localBrowserLaunchOptions: { hasTouch: true } });
      await probe(local, new Error("target closed"));
      expect(local.usesTouch).toBe(true);
    });
  });
});
