// lib/v3/handlers/observeHandler.ts
import { ObserveHandlerParams, V3FunctionName } from "@/lib/v3/types";
import { AvailableModel, ClientOptions } from "@/types/model";
import { LLMClient } from "@/lib/llm/LLMClient";
import { observe as runObserve } from "@/lib/inference";
import { captureHybridSnapshot } from "@/lib/v3/understudy/a11y/snapshot";
import { trimTrailingTextNode } from "@/lib/utils";
import { EncodedId } from "@/types/context";
import { ObserveResult } from "@/types/stagehand";
import { v3Logger } from "@/lib/v3/logger";

export class ObserveHandler {
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;
  private readonly experimental: boolean;
  private readonly onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ) => void;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
    experimental?: boolean,
    onMetrics?: (
      functionName: V3FunctionName,
      promptTokens: number,
      completionTokens: number,
      inferenceTimeMs: number,
    ) => void,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
    this.experimental = experimental ?? false;
    this.onMetrics = onMetrics;
  }

  async observe(params: ObserveHandlerParams): Promise<ObserveResult[]> {
    const { instruction, page, returnAction, fromAct } = params;

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
    const snapshot = await captureHybridSnapshot(page, {
      experimental: this.experimental,
    });

    const combinedTree = snapshot.combinedTree;
    const combinedXpathMap = snapshot.combinedXpathMap ?? {};

    v3Logger({
      category: "observation",
      message: "Got accessibility tree data",
      level: 1,
    });

    // Call the LLM to propose actionable elements
    const observationResponse = await runObserve({
      instruction: effectiveInstruction,
      domElements: combinedTree,
      llmClient: this.llmClient,
      requestId: "1234",
      userProvidedInstructions: this.systemPrompt,
      logger: v3Logger,
      returnAction: returnAction ?? true,
      logInferenceToFile: this.logInferenceToFile,
      fromAct: !!fromAct,
    });

    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      inference_time_ms = 0,
    } = observationResponse;

    // Update OBSERVE metrics from the LLM observation call
    this.onMetrics?.(
      V3FunctionName.OBSERVE,
      prompt_tokens,
      completion_tokens,
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

            return {
              ...rest, // if method/arguments exist, they’re preserved; otherwise they’re absent
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
