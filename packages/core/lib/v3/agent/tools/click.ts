import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { Action } from "../../types/public/methods";
import type { ClickToolResult } from "../../types/public/agent";
import { processCoordinates } from "../utils/coordinateNormalization";
import { ensureXPath } from "../utils/xpath";

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
        );

        v3.logger({
          category: "agent",
          message: `Agent calling tool: click`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, coordinates, processed }),
              type: "string",
            },
          },
        });

        // Use returnXpath to get the XPath of the clicked element for caching
        const xpath = await page.click(processed.x, processed.y, {
          returnXpath: true,
        });

        // Wait for page to settle after click
        await page.waitForTimeout(500);

        // Take screenshot after action for visual feedback
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotBase64 = screenshotBuffer.toString("base64");

        // Record as an "act" step with proper Action for deterministic replay
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
      if (result.screenshotBase64) {
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: JSON.stringify({
                success: result.success,
                describe: result.describe,
                coordinates: result.coordinates,
              }),
            },
            {
              type: "media",
              mediaType: "image/png",
              data: result.screenshotBase64,
            },
          ],
        };
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
