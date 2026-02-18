import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type {
  ScrollToolResult,
  ScrollVisionToolResult,
  ModelOutputContentItem,
} from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";

/**
 * Simple scroll tool for DOM mode (non-grounding models).
 * No coordinates - scrolls from viewport center.
 */
export const scrollTool = (v3: V3) =>
  tool({
    description:
      "Scroll the page up or down by a percentage of the viewport height. Default is 80%, and what should be typically used for general page scrolling",
    inputSchema: z.object({
      direction: z.enum(["up", "down"]),
      percentage: z.number().min(1).max(200).optional(),
    }),
    execute: async ({
      direction,
      percentage = 80,
    }): Promise<ScrollToolResult> => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: scroll`,
        level: 1,
        auxiliary: {
          arguments: {
            value: JSON.stringify({ direction, percentage }),
            type: "object",
          },
        },
      });

      const page = await v3.context.awaitActivePage();

      const { w, h } = await page.mainFrame().evaluate<{
        w: number;
        h: number;
      }>("({ w: window.innerWidth, h: window.innerHeight })");

      const scrollDistance = Math.round((h * percentage) / 100);
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      const deltaY = direction === "up" ? -scrollDistance : scrollDistance;

      await page.scroll(cx, cy, 0, deltaY);

      v3.recordAgentReplayStep({
        type: "scroll",
        deltaX: 0,
        deltaY,
        anchor: { x: cx, y: cy },
      });

      return {
        success: true,
        message: `Scrolled ${percentage}% ${direction} (${scrollDistance}px)`,
        scrolledPixels: scrollDistance,
      };
    },
    toModelOutput: (result) => {
      return {
        type: "json",
        value: {
          success: result.success,
          message: result.message,
          scrolledPixels: result.scrolledPixels,
        },
      };
    },
  });

/**
 * Scroll tool for hybrid mode (grounding models).
 * Supports optional coordinates for scrolling within nested scrollable elements.
 */
export const scrollVisionTool = (v3: V3, provider?: string) =>
  tool({
    description: `Scroll the page up or down. For general page scrolling, no coordinates needed. Only provide coordinates when scrolling inside a nested scrollable element (e.g., a dropdown menu, modal with overflow, or scrollable sidebar). Default is 80%, and what should be typically used for general page scrolling`,
    inputSchema: z.object({
      direction: z.enum(["up", "down"]),
      coordinates: z
        .array(z.number())
        .optional()
        .describe(
          "Only use coordinates for scrolling inside a nested scrollable element - provide (x, y) within that element",
        ),
      percentage: z.number().min(1).max(200).optional(),
    }),
    execute: async ({
      direction,
      coordinates,
      percentage = 80,
    }): Promise<ScrollVisionToolResult> => {
      const page = await v3.context.awaitActivePage();

      const { w, h } = await page.mainFrame().evaluate<{
        w: number;
        h: number;
      }>("({ w: window.innerWidth, h: window.innerHeight })");

      // Process coordinates if provided, otherwise use viewport center
      let cx: number;
      let cy: number;
      if (coordinates) {
        const processed = processCoordinates(
          coordinates[0],
          coordinates[1],
          provider,
          v3,
        );
        cx = processed.x;
        cy = processed.y;
      } else {
        cx = Math.floor(w / 2);
        cy = Math.floor(h / 2);
      }

      v3.logger({
        category: "agent",
        message: `Agent calling tool: scroll`,
        level: 1,
        auxiliary: {
          arguments: {
            value: JSON.stringify({
              direction,
              coordinates,
              percentage,
              processed: { cx, cy },
            }),
            type: "object",
          },
        },
      });

      const scrollDistance = Math.round((h * percentage) / 100);
      const deltaY = direction === "up" ? -scrollDistance : scrollDistance;

      await page.scroll(cx, cy, 0, deltaY);

      const screenshotBase64 = await waitAndCaptureScreenshot(page, 100);

      v3.recordAgentReplayStep({
        type: "scroll",
        deltaX: 0,
        deltaY,
        anchor: { x: cx, y: cy },
      });

      return {
        success: true,
        message: coordinates
          ? `Scrolled ${percentage}% ${direction} at (${cx}, ${cy})`
          : `Scrolled ${percentage}% ${direction}`,
        scrolledPixels: scrollDistance,
        screenshotBase64,
      };
    },
    toModelOutput: (result) => {
      const content: ModelOutputContentItem[] = [
        {
          type: "text",
          text: JSON.stringify({
            success: result.success,
            message: result.message,
            scrolledPixels: result.scrolledPixels,
          }),
        },
      ];
      if (result.screenshotBase64) {
        content.push({
          type: "media",
          mediaType: "image/png",
          data: result.screenshotBase64,
        });
      }
      return { type: "content", value: content };
    },
  });
