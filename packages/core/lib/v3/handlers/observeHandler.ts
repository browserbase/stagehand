// lib/v3/handlers/observeHandler.ts
import { observe as runObserve } from "../../inference.js";
import { trimTrailingTextNode } from "../../utils.js";
import { v3Logger } from "../logger.js";
import { V3FunctionName } from "../types/public/methods.js";
import { captureHybridSnapshot } from "../understudy/a11y/snapshot/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import {
  ObserveHandlerParams,
  SupportedUnderstudyAction,
} from "../types/private/handlers.js";
import { EncodedId } from "../types/private/internal.js";
import { Action } from "../types/public/methods.js";
import {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "../types/public/model.js";
import { ObserveTimeoutError } from "../types/public/sdkErrors.js";
import { createTimeoutGuard } from "./handlerUtils/timeoutGuard.js";

export class ObserveHandler {
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly resolveLlmClient: (model?: ModelConfiguration) => LLMClient;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;
  private readonly experimental: boolean;
  private readonly onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ) => void;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    resolveLlmClient: (model?: ModelConfiguration) => LLMClient,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
    experimental?: boolean,
    onMetrics?: (
      functionName: V3FunctionName,
      promptTokens: number,
      completionTokens: number,
      reasoningTokens: number,
      cachedInputTokens: number,
      inferenceTimeMs: number,
    ) => void,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.resolveLlmClient = resolveLlmClient;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
    this.experimental = experimental ?? false;
    this.onMetrics = onMetrics;
  }

  async observe(params: ObserveHandlerParams): Promise<Action[]> {
    const { instruction, page, timeout, selector, model } = params;

    const llmClient = this.resolveLlmClient(model);

    const effectiveTimeoutMs =
      typeof timeout === "number" && timeout > 0 ? timeout : undefined;
    const ensureTimeRemaining = createTimeoutGuard(
      effectiveTimeoutMs,
      (ms) => new ObserveTimeoutError(ms),
    );

    const effectiveInstruction =
      instruction ??
      "Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.";

    v3Logger({
      category: "observation",
      message: "starting observation",
      level: 1,
      auxiliary: {
        instruction: {
          value: effectiveInstruction,
          type: "string",
        },
      },
    });

    // Build the hybrid snapshot (a11y-centric text tree + lookup maps)
    const focusSelector = selector?.replace(/^xpath=/i, "") ?? "";
    ensureTimeRemaining();
    const snapshot = await captureHybridSnapshot(page, {
      experimental: this.experimental,
      focusSelector: focusSelector || undefined,
    });

    const combinedTree = snapshot.combinedTree;
    const combinedXpathMap = snapshot.combinedXpathMap ?? {};

    v3Logger({
      category: "observation",
      message: "Got accessibility tree data",
      level: 1,
    });

    // Call the LLM to propose actionable elements
    ensureTimeRemaining();
    const observationResponse = await runObserve({
      instruction: effectiveInstruction,
      domElements: combinedTree,
      llmClient,
      userProvidedInstructions: this.systemPrompt,
      logger: v3Logger,
      logInferenceToFile: this.logInferenceToFile,
      supportedActions: Object.values(SupportedUnderstudyAction),
    });

    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      reasoning_tokens = 0,
      cached_input_tokens = 0,
      inference_time_ms = 0,
    } = observationResponse;

    // Update OBSERVE metrics from the LLM observation call
    this.onMetrics?.(
      V3FunctionName.OBSERVE,
      prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      cached_input_tokens,
      inference_time_ms,
    );

    // Map elementIds -> selectors via combinedXpathMap
    const elementsWithSelectors = (
      await Promise.all(
        observationResponse.elements.map(async (element) => {
          const { elementId, ...rest } = element; // rest may or may not have method/arguments
          if (typeof elementId === "string" && elementId.includes("-")) {
            const lookUpIndex = elementId as EncodedId;
            const xpath = combinedXpathMap[lookUpIndex];
            const trimmedXpath = trimTrailingTextNode(xpath);
            if (!trimmedXpath) return undefined;

            // For dragAndDrop, convert element ID in arguments to xpath (target element)
            let resolvedArgs = rest.arguments;
            if (
              rest.method === "dragAndDrop" &&
              Array.isArray(rest.arguments) &&
              rest.arguments.length > 0
            ) {
              const targetArg = rest.arguments[0];
              // Check if argument looks like an element ID (e.g., "1-67")
              if (
                typeof targetArg === "string" &&
                /^\d+-\d+$/.test(targetArg)
              ) {
                const argXpath = combinedXpathMap[targetArg as EncodedId];
                const trimmedArgXpath = trimTrailingTextNode(argXpath);
                if (trimmedArgXpath) {
                  resolvedArgs = [
                    `xpath=${trimmedArgXpath}`,
                    ...rest.arguments.slice(1),
                  ];
                } else {
                  // Target element lookup failed, filter out this action
                  v3Logger({
                    category: "observation",
                    message: "dragAndDrop target element lookup failed",
                    level: 0,
                    auxiliary: {
                      targetElementId: { value: targetArg, type: "string" },
                      sourceElementId: { value: elementId, type: "string" },
                    },
                  });
                  return undefined;
                }
              } else {
                v3Logger({
                  category: "observation",
                  message: "dragAndDrop target element invalid ID format",
                  level: 0,
                  auxiliary: {
                    targetElementId: { value: targetArg, type: "string" },
                    sourceElementId: { value: elementId, type: "string" },
                  },
                });
                return undefined;
              }
            }

            return {
              ...rest,
              arguments: resolvedArgs,
              selector: `xpath=${trimmedXpath}`,
            } as {
              description: string;
              method?: string;
              arguments?: string[];
              selector: string;
            };
          }
          // shadow-root fallback:
          return {
            description: "an element inside a shadow DOM",
            method: "not-supported",
            arguments: [],
            selector: "not-supported",
          };
        }),
      )
    ).filter(<T>(e: T | undefined): e is T => e !== undefined);

    v3Logger({
      category: "observation",
      message: "found elements",
      level: 1,
      auxiliary: {
        elements: {
          value: JSON.stringify(elementsWithSelectors),
          type: "object",
        },
      },
    });

    return elementsWithSelectors;
  }
}
