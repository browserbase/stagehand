import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "@/lib/v3/v3";

export const createScrollTool = (v3: V3) =>
  tool({
    description: "Scroll the page",
    parameters: z.object({
      pixels: z.number().describe("Number of pixels to scroll up or down"),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
    }),
    execute: async ({ pixels, direction }) => {
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
