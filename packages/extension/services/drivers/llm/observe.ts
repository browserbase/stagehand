import type { Action } from "@browserbasehq/stagehand-protocol/types";
import * as inference from "../../../inference.js";
import { SupportedUnderstudyAction } from "../../../types/private/handlers.js";
import type { EncodedId } from "../../../types/private/internal.js";
import { trimTrailingTextNode } from "../../../utils.js";
import type { ObserveDriver } from "../types.js";

const DEFAULT_OBSERVE_INSTRUCTION =
  "Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.";

/** observe() by language model: one inference over the page outline lists the actions. */
export function llmObserveDriver(): ObserveDriver {
  return {
    name: "llm",
    async resolve(request) {
      const { page, snapshotOptions, ensureTimeRemaining, logger, llm } = request;

      ensureTimeRemaining();
      const { combinedTree, combinedXpathMap } = await page.captureSnapshot(snapshotOptions);
      ensureTimeRemaining();
      logger.debug("Captured accessibility snapshot for observation", {
        category: "observation",
      });

      const observation = await inference.observe({
        instruction: request.instruction ?? DEFAULT_OBSERVE_INSTRUCTION,
        domElements: combinedTree,
        generate: (input) => llm.generate(input),
        userProvidedInstructions: llm.systemPrompt,
        supportedActions: Object.values(SupportedUnderstudyAction),
        variables: request.variables,
      });
      llm.record(observation);
      ensureTimeRemaining();

      const xpathMap = (combinedXpathMap ?? {}) as Record<EncodedId, string>;
      const actions: Action[] = [];
      for (const element of observation.elements) {
        const sourceXpath = trimTrailingTextNode(xpathMap[element.elementId as EncodedId]);
        if (!sourceXpath) {
          logger.warn("Observed element could not be resolved to an XPath", {
            category: "observation",
            elementId: element.elementId,
          });
          continue;
        }

        let resolvedArguments = element.arguments;
        if (element.method === SupportedUnderstudyAction.DRAG_AND_DROP) {
          const targetElementId = element.arguments[0];
          if (!targetElementId || !/^\d+-\d+$/.test(targetElementId)) {
            logger.warn("Drag-and-drop target has an invalid element ID", {
              category: "observation",
              sourceElementId: element.elementId,
              targetElementId: targetElementId ?? "",
            });
            continue;
          }

          const targetXpath = trimTrailingTextNode(xpathMap[targetElementId as EncodedId]);
          if (!targetXpath) {
            logger.warn("Drag-and-drop target could not be resolved to an XPath", {
              category: "observation",
              sourceElementId: element.elementId,
              targetElementId,
            });
            continue;
          }
          resolvedArguments = [`xpath=${targetXpath}`, ...element.arguments.slice(1)];
        }

        actions.push({
          selector: `xpath=${sourceXpath}`,
          description: element.description,
          method: element.method,
          arguments: resolvedArguments,
        });
      }

      ensureTimeRemaining();
      logger.info("Observation completed", {
        category: "observation",
        promptTokens: observation.prompt_tokens,
        completionTokens: observation.completion_tokens,
        reasoningTokens: observation.reasoning_tokens,
        cachedInputTokens: observation.cached_input_tokens,
        inferenceTimeMs: observation.inference_time_ms,
        resultCount: actions.length,
      });
      return { kind: "resolved", actions };
    },
  };
}
