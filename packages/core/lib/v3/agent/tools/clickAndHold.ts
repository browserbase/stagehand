import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type {
  ClickAndHoldToolResult,
  ModelOutputContentItem,
} from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";
import { ensureXPath } from "../utils/xpath.js";

export const clickAndHoldTool = (v3: V3, provider?: string) =>
  tool({
    description: "Click and hold on an element using its coordinates",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to click on in a short, specific phrase that mentions the element type and a good visual description",
        ),
      duration: z
        .number()
        .describe("The duration to hold the element in milliseconds"),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to click on"),
    }),
    execute: async ({
      describe,
      coordinates,
      duration,
    }): Promise<ClickAndHoldToolResult> => {
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
          message: `Agent calling tool: clickAndHold`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({
                describe,
                duration,
              }),
              type: "object",
            },
          },
        });

        // Only request XPath when caching is enabled to avoid unnecessary computation
        const shouldCollectXpath = v3.isAgentReplayActive();

        // Use dragAndDrop from same point to same point with delay to simulate click and hold
        const [xpath] = await page.dragAndDrop(
          processed.x,
          processed.y,
          processed.x,
          processed.y,
          { delay: duration, returnXpath: shouldCollectXpath },
        );

        const screenshotBase64 = await waitAndCaptureScreenshot(page);

        // Record as "act" step with proper Action for deterministic replay (only when caching)
        if (shouldCollectXpath) {
          const normalizedXpath = ensureXPath(xpath);
          if (normalizedXpath) {
            const action: Action = {
              selector: normalizedXpath,
              description: describe,
              method: "clickAndHold",
              arguments: [String(duration)],
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
          duration,
          coordinates: [processed.x, processed.y],
          screenshotBase64,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error clicking and holding: ${error.message}`,
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
            duration: result.duration,
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
