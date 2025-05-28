import { LogLine } from "../../types/log";
import { Stagehand, StagehandFunctionName } from "../index";
import { observe } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { StagehandPage } from "../StagehandPage";
import { drawObserveOverlay } from "../utils";
import { getAccessibilityTreeWithFrames } from "../a11y/utils";
import { CombinedA11yResult, EncodedId } from "@/types/context";

export class StagehandObserveHandler {
  private readonly stagehand: Stagehand;
  private readonly logger: (logLine: LogLine) => void;
  private readonly stagehandPage: StagehandPage;

  private readonly userProvidedInstructions?: string;
  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
  }: {
    stagehand: Stagehand;
    logger: (logLine: LogLine) => void;
    stagehandPage: StagehandPage;
    userProvidedInstructions?: string;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  public async observe({
    instruction,
    llmClient,
    requestId,
    returnAction,
    onlyVisible,
    drawOverlay,
    fromAct,
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

    const {
      combinedTree,
      combinedXpathMap,
      combinedUrlMap,
    }: CombinedA11yResult = await getAccessibilityTreeWithFrames(
      this.stagehandPage,
      this.logger,
    );

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
    const elementsWithSelectors = await Promise.all(
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

        const lookUpIndex = elementId as EncodedId;
        const xpath = combinedXpathMap[lookUpIndex];

        if (!xpath || xpath === "") {
          this.logger({
            category: "observation",
            message: `Empty xpath returned for element: ${elementId}`,
            level: 1,
          });
        }

        return {
          ...rest,
          selector: `xpath=${xpath}`,
          // Provisioning or future use if we want to use direct CDP
          // backendNodeId: elementId,
        };
      }),
    );

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
