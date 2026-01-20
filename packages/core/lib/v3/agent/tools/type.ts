import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type {
  TypeToolResult,
  ModelOutputContentItem,
  Variables,
} from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { ensureXPath } from "../utils/xpath.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";
import { substituteVariables } from "../utils/variables.js";

export const typeTool = (v3: V3, provider?: string, variables?: Variables) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const textDescription = hasVariables
    ? `The text to type into the element. Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}`
    : "The text to type into the element";

  return tool({
    description:
      "Type text into an element using its coordinates. This will click the element and then type the text into it (this is the most reliable way to type into an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to type into in a short, specific phrase that mentions the element type and a good visual description",
        ),
      text: z.string().describe(textDescription),
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
          v3,
        );

        // Substitute any %variableName% tokens in the text
        const actualText = substituteVariables(text, variables);

        v3.logger({
          category: "agent",
          message: `Agent calling tool: type`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, text }),
              type: "object",
            },
          },
        });

        // Only request XPath when caching is enabled to avoid unnecessary computation
        const shouldCollectXpath = v3.isAgentReplayActive();
        const xpath = await page.click(processed.x, processed.y, {
          returnXpath: shouldCollectXpath,
        });

        await page.type(actualText);

        const screenshotBase64 = await waitAndCaptureScreenshot(page);

        // Record as an "act" step with proper Action for deterministic replay (only when caching)
        if (shouldCollectXpath) {
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
        }

        return {
          success: true,
          describe,
          text, // Return original text (with %variableName% tokens) to avoid exposing sensitive values to LLM
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
      if (result.success) {
        const content: ModelOutputContentItem[] = [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              describe: result.describe,
              text: result.text,
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
};
