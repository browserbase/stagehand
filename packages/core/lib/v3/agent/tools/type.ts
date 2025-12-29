import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { Action } from "../../types/public/methods";
import type { TypeToolResult } from "../../types/public/agent";
import { processCoordinates } from "../utils/coordinateNormalization";
import { ensureXPath } from "../utils/xpath";
import { waitForTimeout, POST_ACTION_DELAY_MS } from "../utils/timing";

export const typeTool = (v3: V3, provider?: string) =>
  tool({
    description:
      "Type text into an element using its coordinates. This will click the element and then type the text into it (this is the most reliable way to type into an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to type into in a short, specific phrase that mentions the element type and a good visual description",
        ),
      text: z.string().describe("The text to type into the element"),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to type into the element"),
    }),
    execute: async ({
      describe,
      coordinates,
      text,
    }): Promise<TypeToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const processed = processCoordinates(
          coordinates[0],
          coordinates[1],
          provider,
        );

        v3.logger({
          category: "agent",
          message: `Agent calling tool: type`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, coordinates, processed, text }),
              type: "string",
            },
          },
        });

        // Click the element first with returnXpath to get the element's XPath
        const xpath = await page.click(processed.x, processed.y, {
          returnXpath: true,
        });

        await page.type(text);

        // Wait for page to settle after typing
        await waitForTimeout(POST_ACTION_DELAY_MS);

        // Take screenshot after action for visual feedback
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotBase64 = screenshotBuffer.toString("base64");

        // Record as an "act" step with proper Action for deterministic replay
        const normalizedXpath = ensureXPath(xpath);
        if (normalizedXpath) {
          const action: Action = {
            selector: normalizedXpath,
            description: describe,
            method: "type",
            arguments: [text],
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
          text,
          screenshotBase64,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error typing: ${(error as Error).message}`,
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
                text: result.text,
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
