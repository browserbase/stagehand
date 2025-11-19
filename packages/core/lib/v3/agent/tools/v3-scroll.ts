import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createScrollTool = (v3: V3) =>
  tool({
    description: "Scroll the page",
    inputSchema: z.object({
      pixels: z.number().describe("Number of pixels to scroll up or down"),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
    }),
    execute: async ({ pixels, direction }) => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: scroll`,
        level: 1,
        auxiliary: {
          arguments: {
            value: JSON.stringify({ pixels, direction }),
            type: "object",
          },
        },
      });
      const page = await v3.context.awaitActivePage();
      // Determine a reasonable anchor (center of viewport)
      const { w, h } = await page.mainFrame().evaluate<{
        w: number;
        h: number;
      }>("({ w: window.innerWidth, h: window.innerHeight })");
      const cx = Math.max(0, Math.floor(w / 2));
      const cy = Math.max(0, Math.floor(h / 2));
      const deltaY = direction === "up" ? -Math.abs(pixels) : Math.abs(pixels);
      await page.scroll(cx, cy, 0, deltaY);
      v3.recordAgentReplayStep({
        type: "scroll",
        deltaX: 0,
        deltaY,
        anchor: { x: cx, y: cy },
      });
      return { success: true, pixels };
    },
  });
