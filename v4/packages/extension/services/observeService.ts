import type {
  Action,
  ClientModelReference,
  ModelConfig,
  ObserveResult,
  StagehandObserveParams,
} from "../../protocol/types.js";
import { TimeoutError } from "../errors.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import { SupportedUnderstudyAction } from "../types/private/handlers.js";
import type { EncodedId } from "../types/private/internal.js";
import { trimTrailingTextNode } from "../utils.js";
import * as cacheService from "./cacheService.js";
import * as llmService from "./llmService.js";

const DEFAULT_OBSERVE_INSTRUCTION =
  "Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.";

export async function observe({
  params,
  page,
  model,
  clientLLMGenerate,
  logger,
  systemPrompt = "",
  cache,
}: {
  params: StagehandObserveParams;
  page: Pick<Page, "captureSnapshot">;
  model: ModelConfig | ClientModelReference;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
}): Promise<ObserveResult> {
  const { instruction, options } = params;
  const ensureTimeRemaining = createTimeoutGuard(
    options?.timeout,
    (ms) => new TimeoutError("observe()", ms),
  );
  const effectiveInstruction = instruction ?? DEFAULT_OBSERVE_INSTRUCTION;
  const focusSelector = options?.selector?.replace(/^xpath=/i, "") ?? "";

  logger.info("Starting observation", {
    category: "observation",
    instruction: effectiveInstruction,
  });

  return await cacheService.withCache<ObserveResult>({
    method: "observe",
    page,
    data: cacheService.buildObserveCacheData(params),
    selector: options?.selector,
    caching: options?.cache,
    context: cache,
    logger,
    onHit: (value) => {
      const actions = cacheService.normalizeCachedActions(value);
      if (actions.length === 0) {
        throw new Error("Cached observe value contained no usable actions");
      }
      return { result: actions };
    },
    execute: () => runObservation(),
  });

  async function runObservation(): Promise<cacheService.CacheExecuteOutcome<ObserveResult>> {
    ensureTimeRemaining();
    const { combinedTree, combinedXpathMap } = await page.captureSnapshot({
      focusSelector: focusSelector || undefined,
      ignoreSelectors: options?.ignoreSelectors,
    });
    ensureTimeRemaining();

    logger.info("Captured accessibility snapshot for observation", {
      category: "observation",
    });

    const observation = await inference.observe({
      instruction: effectiveInstruction,
      domElements: combinedTree,
      generate: (input) => llmService.generate(model, input, clientLLMGenerate),
      userProvidedInstructions: systemPrompt,
      supportedActions: Object.values(SupportedUnderstudyAction),
      variables: options?.variables,
    });
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

    return {
      result: { result: actions },
      cacheValue: actions.length > 0 ? actions : undefined,
      llmUsage: {
        inputTokens: observation.prompt_tokens,
        outputTokens: observation.completion_tokens,
        llmDurationMs: observation.inference_time_ms,
      },
    };
  }
}
