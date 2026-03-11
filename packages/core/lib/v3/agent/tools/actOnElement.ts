import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type { EncodedId } from "../../types/private/internal.js";
import { trimTrailingTextNode } from "../../../utils.js";
import { captureHybridSnapshot } from "../../understudy/a11y/snapshot/index.js";
import { performUnderstudyMethod } from "../../handlers/handlerUtils/actHandlerUtils.js";

const SUPPORTED_ACTIONS = [
  "click",
  "fill",
  "type",
  "press",
  "hover",
  "doubleClick",
  "selectOptionFromDropdown",
] as const;

type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

export const actOnElementTool = (v3: V3) =>
  tool({
    description:
      "Act directly on an element from the ariaTree by its ID. " +
      "Use this after calling ariaTree when you already know the target element — " +
      "faster than act because it skips redundant element inference.",
    inputSchema: z.object({
      elementId: z
        .string()
        .describe("The element ID from ariaTree, e.g. '0-37'"),
      action: z
        .enum(SUPPORTED_ACTIONS)
        .describe("The action to perform on the element"),
      value: z
        .string()
        .optional()
        .describe(
          "Text to type/fill, key to press, or option to select (required for fill, type, press, selectOptionFromDropdown)",
        ),
    }),
    execute: async ({ elementId, action, value }) => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: actOnElement`,
          level: 1,
          auxiliary: {
            elementId: { value: elementId, type: "string" },
            action: { value: action, type: "string" },
            ...(value ? { value: { value, type: "string" as const } } : {}),
          },
        });

        const page = await v3.context.awaitActivePage();
        const snapshot = await captureHybridSnapshot(page, {
          experimental: true,
        });

        const xpathMap = snapshot.combinedXpathMap ?? {};
        const rawXpath = xpathMap[elementId as EncodedId];
        const xpath = trimTrailingTextNode(rawXpath);

        if (!xpath) {
          return {
            success: false,
            error:
              `Element "${elementId}" not found in the current DOM. ` +
              `The page may have changed since ariaTree was last called. ` +
              `Re-fetch ariaTree or fall back to the act tool.`,
          };
        }

        const args: string[] = needsValue(action) && value ? [value] : [];

        await performUnderstudyMethod(
          page,
          page.mainFrame(),
          action,
          `xpath=${xpath}`,
          args,
        );

        const replayAction: Action = {
          selector: `xpath=${xpath}`,
          description: `${action} on element [${elementId}]`,
          method: action,
          arguments: args,
        };

        v3.recordAgentReplayStep({
          type: "act",
          instruction: `${action} on element [${elementId}]`,
          actions: [replayAction],
          actionDescription: `${action} on element [${elementId}]`,
        });

        return {
          success: true,
          action,
          elementId,
          selector: `xpath=${xpath}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message ?? String(error),
        };
      }
    },
  });

function needsValue(action: SupportedAction): boolean {
  return (
    action === "fill" ||
    action === "type" ||
    action === "press" ||
    action === "selectOptionFromDropdown"
  );
}
