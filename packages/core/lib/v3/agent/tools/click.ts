import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type {
  ClickToolResult,
  ModelOutputContentItem,
} from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { ensureXPath } from "../utils/xpath.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";

export const clickTool = (v3: V3, provider?: string) =>
  tool({
    description:
      "Click on an element using its coordinates (this is the most reliable way to click on an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to click on in a short, specific phrase that mentions the element type and a good visual description",
        ),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to click on"),
    }),
    execute: async ({ describe, coordinates }): Promise<ClickToolResult> => {
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
          message: `Agent calling tool: click`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe }),
              type: "object",
            },
          },
        });

        // Only request XPath when caching is enabled to avoid unnecessary computation
        const shouldCollectXpath = v3.isAgentReplayActive();
        const xpath = await page.click(processed.x, processed.y, {
          returnXpath: shouldCollectXpath,
        });

        const screenshotBase64 = await waitAndCaptureScreenshot(page);

        // Record as an "act" step with proper Action for deterministic replay (only when caching)
        if (shouldCollectXpath) {
          const normalizedXpath = ensureXPath(xpath);
          if (normalizedXpath) {
            const action: Action = {
              selector: normalizedXpath,
              description: describe,
              method: "click",
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
          error: `Error clicking: ${(error as Error).message}`,
        };
      }
    },
    toModelOutput: (result) => {
      if (result.success) {
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
      }
      return {
        type: "content",
        value: [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              error: result.error,
            }),
          },
        ],
      };
    },
  });
