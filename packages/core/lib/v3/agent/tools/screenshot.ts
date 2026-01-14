import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import {
  applyMaskOverlays,
  runScreenshotCleanups,
  selectorsToLocators,
  DEFAULT_MASK_COLOR,
  type ScreenshotCleanup,
} from "../../understudy/screenshotUtils";
import type { ToolMaskConfig } from "./index";

export const screenshotTool = (v3: V3, maskConfig?: ToolMaskConfig) =>
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
      const cleanupTasks: ScreenshotCleanup[] = [];

      try {
        // Apply mask overlays if configured
        if (maskConfig?.selectors && maskConfig.selectors.length > 0) {
          const locators = selectorsToLocators(page, maskConfig.selectors);
          if (locators.length > 0) {
            const cleanup = await applyMaskOverlays(
              locators,
              maskConfig.color ?? DEFAULT_MASK_COLOR,
            );
            cleanupTasks.push(cleanup);
          }
        }

        const buffer = await page.screenshot({ fullPage: false });
        const pageUrl = page.url();
        return {
          base64: buffer.toString("base64"),
          timestamp: Date.now(),
          pageUrl,
        };
      } finally {
        await runScreenshotCleanups(cleanupTasks);
      }
    },
    toModelOutput: (result) => ({
      type: "content",
      value: [{ type: "media", mediaType: "image/png", data: result.base64 }],
    }),
  });
