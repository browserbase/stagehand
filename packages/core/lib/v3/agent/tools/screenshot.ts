import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const screenshotTool = (v3: V3) =>
  tool({
    description:
      "Takes a screenshot (PNG) of the current page. Use this to quickly verify page state.",
    inputSchema: z.object({}),
    execute: async () => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: screenshot`,
        level: 1,
      });
      const page = await v3.context.awaitActivePage();

      // Get viewport metrics to detect stealth mode
      const metrics = await page.mainFrame().evaluate<{
        innerW: number;
        innerH: number;
        clientW: number;
        clientH: number;
      }>(`({
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        clientW: document.documentElement.clientWidth,
        clientH: document.documentElement.clientHeight,
      })`);

      // Detect stealth mode: inner != client when stealth spoofs values
      const isStealthMode =
        metrics.innerW !== metrics.clientW ||
        metrics.innerH !== metrics.clientH;

      let buffer: Buffer;
      if (isStealthMode) {
        // Stealth: use unclipped - natural capture matches spoofed content area
        buffer = await page.screenshot({ fullPage: false });
      } else {
        // Normal: clip to innerW/H - unclipped may include browser chrome
        buffer = await page.screenshot({
          fullPage: false,
          clip: { x: 0, y: 0, width: metrics.innerW, height: metrics.innerH },
        });
      }

      const pageUrl = page.url();
      return {
        base64: buffer.toString("base64"),
        timestamp: Date.now(),
        pageUrl,
      };
    },
    toModelOutput: (result) => ({
      type: "content",
      value: [{ type: "media", mediaType: "image/png", data: result.base64 }],
    }),
  });
