import { LogLine } from "../../types/log";
import { Stagehand, StagehandFunctionName } from "../index";
import { observe } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { StagehandPage } from "../StagehandPage";
import { drawObserveOverlay, trimTrailingTextNode } from "../utils";
import {
  getAccessibilityTree,
  getAccessibilityTreeWithFrames,
} from "../a11y/utils";
import { AccessibilityNode, EncodedId } from "@/types/context";

export class StagehandObserveHandler {
  private readonly stagehand: Stagehand;
  private readonly logger: (logLine: LogLine) => void;
  private readonly stagehandPage: StagehandPage;
  private readonly experimental: boolean;

  private readonly userProvidedInstructions?: string;
  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
    experimental,
  }: {
    stagehand: Stagehand;
    logger: (logLine: LogLine) => void;
    stagehandPage: StagehandPage;
    userProvidedInstructions?: string;
    experimental: boolean;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
    this.experimental = experimental;
  }

  public async observe({
    instruction,
    llmClient,
    requestId,
    returnAction,
    onlyVisible,
    drawOverlay,
    fromAct,
    iframes,
  }: {
    instruction: string;
    llmClient: LLMClient;
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
  }) {
    if (!instruction) {
      instruction = `Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.`;
    }

    this.logger({
      category: "observation",
      message: "starting observation",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
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

    await this.stagehandPage._waitForSettledDom();
    this.logger({
      category: "observation",
      message: "Getting accessibility tree data",
      level: 1,
    });
    const { combinedTree, combinedXpathMap, discoveredIframes } = await (iframes
      ? getAccessibilityTreeWithFrames(
          this.experimental,
          this.stagehandPage,
          this.logger,
        ).then(({ combinedTree, combinedXpathMap }) => ({
          combinedTree,
          combinedXpathMap,
          discoveredIframes: [] as AccessibilityNode[],
        }))
      : getAccessibilityTree(
          this.experimental,
          this.stagehandPage,
          this.logger,
        ).then(({ simplified, xpathMap, idToUrl, iframes: frameNodes }) => ({
          combinedTree: simplified,
          combinedXpathMap: xpathMap,
          combinedUrlMap: idToUrl,
          discoveredIframes: frameNodes,
        })));

    // No screenshot or vision-based annotation is performed
    const observationResponse = await observe({
      instruction,
      domElements: combinedTree,
      llmClient,
      requestId,
      userProvidedInstructions: this.userProvidedInstructions,
      logger: this.logger,
      returnAction,
      logInferenceToFile: this.stagehand.logInferenceToFile,
      fromAct: fromAct,
    });

    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      inference_time_ms = 0,
    } = observationResponse;

    this.stagehand.updateMetrics(
      fromAct ? StagehandFunctionName.ACT : StagehandFunctionName.OBSERVE,
      prompt_tokens,
      completion_tokens,
      inference_time_ms,
    );

    //Add iframes to the observation response if there are any on the page
    if (discoveredIframes.length > 0) {
      this.logger({
        category: "observation",
        message: `Warning: found ${discoveredIframes.length} iframe(s) on the page. If you wish to interact with iframe content, please make sure you are setting iframes: true`,
        level: 1,
      });

      discoveredIframes.forEach((iframe) => {
        observationResponse.elements.push({
          elementId: this.stagehandPage.encodeWithFrameId(
            undefined,
            Number(iframe.nodeId),
          ),
          description: "an iframe",
          method: "not-supported",
          arguments: [],
        });
      });
    }

    const elementsWithSelectors = (
      await Promise.all(
        observationResponse.elements.map(async (element) => {
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
