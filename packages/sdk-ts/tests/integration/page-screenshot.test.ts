import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScreenshotOptions, Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

type Point = { x: number; y: number };

async function inspectScreenshotPixels(
  page: Awaited<ReturnType<typeof firstPage>>,
  bytes: Uint8Array,
  points: Point[],
  expected: [number, number, number],
  tolerance = 0,
) {
  return page.evaluate(
    async ({ dataUrl, points, expected, tolerance }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const matchesAt = (index: number) =>
        Math.abs(pixels[index]! - expected[0]) <= tolerance &&
        Math.abs(pixels[index + 1]! - expected[1]) <= tolerance &&
        Math.abs(pixels[index + 2]! - expected[2]) <= tolerance;
      let matchingPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (matchesAt(index)) matchingPixels += 1;
      }
      return {
        matchingPixels,
        pointMatches: points.map(({ x, y }) => matchesAt((y * image.width + x) * 4)),
      };
    },
    {
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      points,
      expected,
      tolerance,
    },
  );
}

describe("Page.screenshot options", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("rejects clip combined with fullPage", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<body>test</body>");

    await expect(
      page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: 100, height: 100 } }),
    ).rejects.toThrow(/fullPage and clip/i);
  });

  it("rejects unsupported image types", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<body>test</body>");

    await expect(page.screenshot({ type: "webp" } as unknown as ScreenshotOptions)).rejects.toThrow(
      /expected one of.*png.*jpeg/i,
    );
  });

  it("rejects jpeg quality for png screenshots", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<body>test</body>");

    await expect(page.screenshot({ type: "png", quality: 50 })).rejects.toThrow(/quality/i);
  });

  it("writes advanced screenshots and removes temporary overlays", async () => {
    const page = await firstPage(stagehand);
    const outputPath = path.join(os.tmpdir(), `stagehand-screenshot-${Date.now()}.jpeg`);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<style>.mask { width:80px;height:80px;background:green }</style><div class="mask"></div><input autofocus>`)}`,
    );
    const stylesBefore = await page.evaluate(() => ({
      bodyBorder: getComputedStyle(document.body).border,
      maskBackground: getComputedStyle(document.querySelector(".mask")!).backgroundColor,
    }));

    try {
      const bytes = await page.screenshot({
        animations: "disabled",
        caret: "hide",
        clip: { x: 0, y: 0, width: 200, height: 200 },
        mask: [page.locator(".mask")],
        maskColor: "rgba(255, 0, 0, 0.4)",
        omitBackground: true,
        path: outputPath,
        quality: 80,
        scale: "css",
        style: "body { border: 3px solid black; }",
        type: "jpeg",
      });

      expect(bytes.length).toBeGreaterThan(0);
      expect((await fs.stat(outputPath)).size).toBe(bytes.length);
      await expect(
        page.evaluate(() => ({
          bodyBorder: getComputedStyle(document.body).border,
          maskBackground: getComputedStyle(document.querySelector(".mask")!).backgroundColor,
        })),
      ).resolves.toEqual(stylesBefore);
    } finally {
      await fs.rm(outputPath, { force: true });
    }
  });

  it("masks elements inside the dialog top layer", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<style>#dialog { transform: translate(35px, 25px); }</style><dialog id="dialog"><input id="secret" value="top-layer"></dialog><script>dialog.showModal()</script>`)}`,
    );

    const secret = page.locator("#secret");
    const center = await page.evaluate(() => {
      const rect = document.querySelector<HTMLInputElement>("#secret")!.getBoundingClientRect();
      return {
        x: Math.floor(rect.left + rect.width / 2),
        y: Math.floor(rect.top + rect.height / 2),
      };
    });
    const bytes = await page.screenshot({
      mask: [secret],
      maskColor: "#ff00ff",
      scale: "css",
    });
    expect(bytes.length).toBeGreaterThan(0);
    const maskPixels = await inspectScreenshotPixels(page, bytes, [center], [255, 0, 255], 15);
    expect(maskPixels.matchingPixels).toBeGreaterThan(100);
    expect(maskPixels.pointMatches).toEqual([true]);
    await expect(
      page.evaluate(() => {
        const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
        const secret = document.querySelector<HTMLInputElement>("#secret")!;
        return {
          dialogOpen: dialog.open,
          inputValue: secret.value,
          visibility: getComputedStyle(secret).visibility,
        };
      }),
    ).resolves.toEqual({ dialogOpen: true, inputValue: "top-layer", visibility: "visible" });
  });

  it("masks every deep-locator match and respects nth() across an iframe hop", async () => {
    const page = await firstPage(stagehand);
    const child = `<style>body{margin:0}.secret{position:absolute;width:40px;height:40px;background:#00aa00}.first{left:10px;top:10px}.second{left:70px;top:10px}</style><div class="secret first"></div><div class="secret second"></div>`;
    await page.goto(
      `data:text/html,${encodeURIComponent(`<iframe id="child" style="position:absolute;left:20px;top:20px;width:180px;height:80px;border:0" srcdoc="${child.replaceAll('"', "&quot;")}"></iframe>`)}`,
    );

    const secrets = page.locator("iframe#child >> .secret");
    await expect.poll(() => secrets.count()).toBe(2);
    const centers = await page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>("#child")!;
      const frameRect = iframe.getBoundingClientRect();
      return Array.from(iframe.contentDocument!.querySelectorAll<HTMLElement>(".secret")).map(
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.floor(frameRect.left + rect.left + rect.width / 2),
            y: Math.floor(frameRect.top + rect.top + rect.height / 2),
          };
        },
      );
    });

    const sampleMask = async (mask: [typeof secrets], color: string) => {
      const bytes = await page.screenshot({ mask, maskColor: color, scale: "css" });
      return inspectScreenshotPixels(
        page,
        bytes,
        centers,
        color === "#ff00ff" ? [255, 0, 255] : [0, 255, 255],
      );
    };

    await expect(sampleMask([secrets], "#ff00ff")).resolves.toMatchObject({
      pointMatches: [true, true],
    });
    await expect(sampleMask([secrets.nth(1)], "#00ffff")).resolves.toMatchObject({
      pointMatches: [false, true],
    });
  });
});
