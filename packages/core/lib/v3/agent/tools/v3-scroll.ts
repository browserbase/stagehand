import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createScrollTool = (v3: V3) =>
  tool({
    description:
      "Scroll the page by a percentage of the current viewport height. More dynamic and robust than fixed pixel amounts.",
    inputSchema: z.object({
      percentage: z
        .number()
        .min(1)
        .max(200)
        .default(80)
        .describe(
          "Percentage of viewport height to scroll (1-200%, default: 80%)",
        ),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
      coordinates: z
        .array(z.number())
        .optional()
        .describe(
          "Optional (x, y) coordinates to scroll at. If not provided, scrolls at the center of the viewport.",
        ),
    }),
    execute: async ({ percentage = 80, direction, coordinates }) => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: scroll`,
        level: 1,
        auxiliary: {
          arguments: {
            value: JSON.stringify({ percentage, direction, coordinates }),
            type: "object",
          },
        },
      });
      const page = await v3.context.awaitActivePage();

      // Get viewport dimensions
      const { w, h } = await page.mainFrame().evaluate<{
        w: number;
        h: number;
      }>("({ w: window.innerWidth, h: window.innerHeight })");

      // Calculate scroll distance based on percentage of viewport height
      const scrollDistance = Math.round((h * percentage) / 100);

      // Use provided coordinates or default to center of viewport
      const cx =
        coordinates && coordinates.length >= 2
          ? coordinates[0]
          : Math.max(0, Math.floor(w / 2));
      const cy =
        coordinates && coordinates.length >= 2
          ? coordinates[1]
          : Math.max(0, Math.floor(h / 2));

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
        message: `Scrolled ${percentage}% of viewport ${direction} (${scrollDistance}px of ${h}px viewport height)`,
        scrolledPixels: scrollDistance,
        viewportHeight: h,
      };
    },
  });
