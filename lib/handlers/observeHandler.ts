import { LogLine } from "../../types/log";
import { ContextManager } from "../context";
import { StagehandPage } from "../StagehandPage";
import { Stagehand, StagehandFunctionName } from "../index";
// Removed direct accessibility tree imports - now handled by ContextManager
import { drawObserveOverlay, trimTrailingTextNode } from "../utils";
import { EncodedId } from "@/types/context";

export class StagehandObserveHandler {
  private readonly stagehand: Stagehand;
  private readonly logger: (logLine: LogLine) => void;
  private readonly stagehandPage: StagehandPage;
  private readonly contextManager: ContextManager;

  private readonly userProvidedInstructions?: string;
  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
    contextManager,
  }: {
    stagehand: Stagehand;
    logger: (logLine: LogLine) => void;
    stagehandPage: StagehandPage;
    userProvidedInstructions?: string;
    contextManager: ContextManager;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
    this.contextManager = contextManager;
  }

  public async observe({
    instruction,
    requestId,
    returnAction,
    onlyVisible,
    drawOverlay,
    fromAct,
    iframes,
    dynamic,
  }: {
    instruction: string;
    requestId: string;
    domSettleTimeoutMs?: number;
    returnAction?: boolean;
    /**
     * @deprecated The `onlyVisible` parameter has no effect in this version of Stagehand and will be removed in later versions.
     */
    onlyVisible?: boolean;
    drawOverlay?: boolean;
    fromAct?: boolean;
    iframes?: boolean;
    dynamic?: boolean;
  }) {
    if (!instruction) {
      instruction = `Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.`;
    }

    this.logger({
      category: "observation",
      message: "starting observe",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
      },
    });

    if (onlyVisible !== undefined) {
      this.logger({
        category: "observation",
        message:
          "Warning: the `onlyVisible` parameter has no effect in this version of Stagehand and will be removed in future versions.",
        level: 1,
      });
    }

    // Call performObserve - it builds context internally with the instruction
    const observationResponse = await this.contextManager.performObserve({
      instruction,
      requestId,
      userProvidedInstructions: this.userProvidedInstructions,
      returnAction,
      iframes,
      dynamic,
    });

    const {
      elements,
      xpathMapping: combinedXpathMap,
      prompt_tokens = 0,
      completion_tokens = 0,
      inference_time_ms = 0,
      promptData,
    } = observationResponse;

    this.stagehand.updateMetrics(
      fromAct ? StagehandFunctionName.ACT : StagehandFunctionName.OBSERVE,
      prompt_tokens,
      completion_tokens,
      inference_time_ms,
    );

    // Log inference data to files if enabled
    this.stagehand.logInferenceData(
      fromAct ? StagehandFunctionName.ACT : StagehandFunctionName.OBSERVE,
      {
        instruction,
        requestId,
        response: observationResponse,
        promptTokens: prompt_tokens,
        completionTokens: completion_tokens,
        inferenceTimeMs: inference_time_ms,
        promptData,
        metadata: {
          fromAct,
          returnAction,
          elementsFound: elements.length,
        },
      },
    );

    // Iframe handling is now done by ContextManager

    const elementsWithSelectors = (
      await Promise.all(
        elements.map(async (element) => {
          const { elementId, ...rest } = element;

          // Generate xpath for the given element if not found in selectorMap
          this.logger({
            category: "observation",
            message: "Getting xpath for element",
            level: 1,
            auxiliary: {
              elementId: {
                value: elementId.toString(),
                type: "string",
              },
            },
          });

          if (elementId.includes("-")) {
            const lookUpIndex = elementId as EncodedId;
            const xpath: string | undefined = combinedXpathMap[lookUpIndex];

            const trimmedXpath = trimTrailingTextNode(xpath);

            if (!trimmedXpath || trimmedXpath === "") {
              this.logger({
                category: "observation",
                message: `Empty xpath returned for element`,
                auxiliary: {
                  observeResult: {
                    value: JSON.stringify(element),
                    type: "object",
                  },
                },
                level: 1,
              });
              return undefined;
            }

            return {
              ...rest,
              selector: `xpath=${trimmedXpath}`,
              // Provisioning or future use if we want to use direct CDP
              // backendNodeId: elementId,
            };
          } else {
            this.logger({
              category: "observation",
              message: `Element is inside a shadow DOM: ${elementId}`,
              level: 0,
            });
            return {
              description: "an element inside a shadow DOM",
              method: "not-supported",
              arguments: [] as string[],
              selector: "not-supported",
            };
          }
        }),
      )
    ).filter(<T>(e: T | undefined): e is T => e !== undefined);

    this.logger({
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

    if (drawOverlay) {
      await drawObserveOverlay(this.stagehandPage.page, elementsWithSelectors);
    }

    return elementsWithSelectors;
  }
}
