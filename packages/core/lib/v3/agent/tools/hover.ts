import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type { ModelOutputContentItem } from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { ensureXPath } from "../utils/xpath.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";

interface HoverToolResult {
  success: boolean;
  describe?: string;
  coordinates?: number[];
  error?: string;
  screenshotBase64?: string;
}

export const hoverTool = (v3: V3, provider?: string) =>
  tool({
    description:
      "Hover over an element using its coordinates to reveal tooltips, dropdown menus, " +
      "sub-navigation, or other hover-triggered content. Returns a screenshot after hovering.",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to hover over in a short, specific phrase",
        ),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to hover over"),
    }),
    execute: async ({ describe, coordinates }): Promise<HoverToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const processed = processCoordinates(
          coordinates[0],
          coordinates[1],
          provider,
          v3,
        );

        v3.logger({
          category: "agent",
          message: `Agent calling tool: hover`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe }),
              type: "object",
            },
          },
        });

        const shouldCollectXpath = v3.isAgentReplayActive();
        const xpath = await page.hover(processed.x, processed.y, {
          returnXpath: shouldCollectXpath,
        });

        const screenshotBase64 = await waitAndCaptureScreenshot(page, 300);

        if (shouldCollectXpath) {
          const normalizedXpath = ensureXPath(xpath);
          if (normalizedXpath) {
            const action: Action = {
              selector: normalizedXpath,
              description: describe,
              method: "hover",
              arguments: [],
            };
            v3.recordAgentReplayStep({
              type: "act",
              instruction: describe,
              actions: [action],
              actionDescription: describe,
            });
          }
        }

        return {
          success: true,
          describe,
          coordinates: [processed.x, processed.y],
          screenshotBase64,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error hovering: ${(error as Error).message}`,
        };
      }
    },
    toModelOutput: (result) => {
      if (result.success === false || result.error !== undefined) {
        return {
          type: "content",
          value: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      const content: ModelOutputContentItem[] = [
        {
          type: "text",
          text: JSON.stringify({
            success: result.success,
            describe: result.describe,
            coordinates: result.coordinates,
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
