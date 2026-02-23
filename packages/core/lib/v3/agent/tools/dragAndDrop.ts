import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type {
  DragAndDropToolResult,
  ModelOutputContentItem,
} from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { ensureXPath } from "../utils/xpath.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";

export const dragAndDropTool = (v3: V3, provider?: string) =>
  tool({
    description:
      "Drag and drop an element using its coordinates (this is the most reliable way to drag and drop an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z.string().describe("Describe the element to drag and drop"),
      startCoordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to start the drag and drop from"),
      endCoordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to end the drag and drop at"),
    }),
    execute: async ({
      describe,
      startCoordinates,
      endCoordinates,
    }): Promise<DragAndDropToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const processedStart = processCoordinates(
          startCoordinates[0],
          startCoordinates[1],
          provider,
          v3,
        );
        const processedEnd = processCoordinates(
          endCoordinates[0],
          endCoordinates[1],
          provider,
          v3,
        );

        v3.logger({
          category: "agent",
          message: `Agent calling tool: dragAndDrop`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({
                describe,
              }),
              type: "object",
            },
          },
        });

        // Only request XPath when caching is enabled to avoid unnecessary computation
        const shouldCollectXpath = v3.isAgentReplayActive();
        const [fromXpath, toXpath] = await page.dragAndDrop(
          processedStart.x,
          processedStart.y,
          processedEnd.x,
          processedEnd.y,
          { returnXpath: shouldCollectXpath },
        );

        const screenshotBase64 = await waitAndCaptureScreenshot(page);

        // Record as "act" step with proper Action for deterministic replay (only when caching)
        if (shouldCollectXpath) {
          const normalizedFrom = ensureXPath(fromXpath);
          const normalizedTo = ensureXPath(toXpath);
          if (normalizedFrom && normalizedTo) {
            const action: Action = {
              selector: normalizedFrom,
              description: describe,
              method: "dragAndDrop",
              arguments: [normalizedTo],
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
          screenshotBase64,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error dragging: ${(error as Error).message}`,
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
