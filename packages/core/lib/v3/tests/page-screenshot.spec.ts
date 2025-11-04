import { test, expect } from "@playwright/test";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { Frame } from "../understudy/frame";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe("Page.screenshot options", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("rejects clip combined with fullPage", async () => {
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>test</body></html>");

    await expect(
      page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ).rejects.toThrow(/clip and fullPage/);
  });

  test("rejects unsupported image type", async () => {
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>noop</body></html>");

    await expect(
      page.screenshot({
        // @ts-expect-error intentional invalid type for runtime validation
        type: "webp",
      }),
    ).rejects.toThrow(/unsupported image type/);
  });

  test("rejects jpeg quality for png screenshots", async () => {
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>noop</body></html>");

    await expect(page.screenshot({ type: "png", quality: 50 })).rejects.toThrow(
      /quality option is only valid/,
    );
  });

  test("honours timeout option", async () => {
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>noop</body></html>");

    const mainFrame = page.mainFrame();
    const originalScreenshot = mainFrame.screenshot.bind(mainFrame);

    (
      mainFrame as typeof mainFrame & {
        screenshot: typeof mainFrame.screenshot;
      }
    ).screenshot = async () => {
      await wait(50);
      return Buffer.from("late");
    };

    try {
      await expect(page.screenshot({ timeout: 10 })).rejects.toThrow(/timeout/);
    } finally {
      (
        mainFrame as typeof mainFrame & {
          screenshot: typeof mainFrame.screenshot;
        }
      ).screenshot = originalScreenshot;
    }
  });

  test("applies advanced options and cleans up overlays", async () => {
    const page = v3.context.pages()[0];

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { background: #aaccee; margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: flex-start; }
            #mask-target { width: 80px; height: 80px; margin: 40px; background: rgb(0, 180, 60); animation: pulse 1s infinite alternate; }
            @keyframes pulse { from { transform: scale(1); } to { transform: scale(1.2); } }
          </style>
        </head>
        <body>
          <div id="mask-target"></div>
          <input id="focus-me" value="focus" />
          <script>document.getElementById('focus-me').focus();</script>
        </body>
      </html>
    `;

    await page.goto("data:text/html," + encodeURIComponent(html));

    const maskLocator = page.locator("#mask-target");
    const tempPath = path.join(
      os.tmpdir(),
      `stagehand-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}.jpeg`,
    );

    const targetId = page.targetId();
    const screenshotCalls: Array<{
      frameId: string;
      options: Parameters<Frame["screenshot"]>[0];
    }> = [];
    const evaluateCalls: Array<{ frameId: string; arg: unknown }> = [];
    const originalScreenshot = Frame.prototype.screenshot;
    const originalEvaluate = Frame.prototype.evaluate;

    // Hook Frame.screenshot so we can assert which options reach CDP without writing real data.
    Frame.prototype.screenshot = async function screenshotSpy(options) {
      const frame = this as Frame;
      if (frame.pageId === targetId) {
        screenshotCalls.push({ frameId: frame.frameId, options });
        return Buffer.from("stub-image");
      }
      return originalScreenshot.call(this, options);
    };

    // Spy on Frame.evaluate to capture the arguments used to inject CSS/masks.
    Frame.prototype.evaluate = async function evaluateSpy(expression, arg?) {
      const frame = this as Frame;
      if (frame.pageId === targetId) {
        evaluateCalls.push({ frameId: frame.frameId, arg });
      }
      return originalEvaluate.call(this, expression as never, arg);
    } as Frame["evaluate"];

    const internalPage = page as unknown as {
      mainSession: {
        send: (method: string, params?: unknown) => Promise<unknown>;
      };
    };
    const sendCalls: Array<{ method: string; params: unknown }> = [];
    const originalSend = internalPage.mainSession.send.bind(
      internalPage.mainSession,
    ) as (method: string, params?: unknown) => Promise<unknown>;
    // Capture background overrides so we can confirm omitBackground toggles on/off.
    internalPage.mainSession.send = async (
      method: string,
      params?: unknown,
    ) => {
      sendCalls.push({ method, params });
      return originalSend(method, params);
    };

    try {
      const buffer = await page.screenshot({
        animations: "disabled",
        caret: "hide",
        clip: { x: 0, y: 0, width: 200, height: 200 },
        mask: [maskLocator],
        maskColor: "rgba(255, 0, 0, 0.4)",
        omitBackground: true,
        path: tempPath,
        quality: 80,
        scale: "css",
        style: "body { border: 3px solid black; }",
        timeout: 2000,
        type: "jpeg",
      });

      expect(Buffer.isBuffer(buffer)).toBeTruthy();
      expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
      const recorded = screenshotCalls[0]?.options ?? {};
      expect(recorded).toMatchObject({ type: "jpeg", quality: 80 });
      expect(recorded?.clip).toMatchObject({
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      });
      if (typeof recorded?.scale === "number") {
        expect(recorded.scale).toBeGreaterThan(0);
        expect(recorded.scale).toBeLessThanOrEqual(2);
      }

      await fs.stat(tempPath);

      const maskNodes = await page.evaluate(
        () => document.querySelectorAll("[data-stagehand-mask]").length,
      );
      expect(maskNodes).toBe(0);

      const styleNodes = await page.evaluate(
        () => document.querySelectorAll("[data-stagehand-style]").length,
      );
      expect(styleNodes).toBe(0);

      const backgroundCalls = sendCalls.filter(
        (call) => call.method === "Emulation.setDefaultBackgroundColorOverride",
      );
      expect(backgroundCalls.length).toBeGreaterThan(1);
      expect(
        backgroundCalls.some(
          (call) =>
            call.params &&
            typeof call.params === "object" &&
            "color" in (call.params as Record<string, unknown>),
        ),
      ).toBeTruthy();
      expect(
        backgroundCalls.some(
          (call) =>
            !call.params ||
            Object.keys(call.params as Record<string, unknown>).length === 0,
        ),
      ).toBeTruthy();

      const cssArgs = evaluateCalls
        .map((entry) => {
          const value = entry.arg as { css?: string } | undefined;
          return value?.css ?? null;
        })
        .filter((css): css is string => typeof css === "string");

      const tokens = evaluateCalls
        .map((entry) => {
          const arg = entry.arg as { token?: string } | undefined;
          return arg?.token ?? null;
        })
        .filter((token): token is string => typeof token === "string");

      // Tokens include which helper injected the style (animations/caret/custom).
      expect(tokens.some((token) => token.includes("animations"))).toBeTruthy();
      expect(tokens.some((token) => token.includes("caret"))).toBeTruthy();
      expect(tokens.some((token) => token.includes("custom"))).toBeTruthy();
      // Custom style should bubble through so we check the actual CSS text.
      expect(
        cssArgs.some((css) => css.includes("border: 3px solid black")),
      ).toBeTruthy();

      expect(
        evaluateCalls.some((entry) => {
          const arg = entry.arg;
          return (
            arg &&
            typeof arg === "object" &&
            "rects" in (arg as Record<string, unknown>)
          );
        }),
      ).toBeTruthy();
    } finally {
      Frame.prototype.screenshot = originalScreenshot;
      Frame.prototype.evaluate = originalEvaluate;
      internalPage.mainSession.send = originalSend;
      await fs.unlink(tempPath).catch(() => {});
    }
  });
});
