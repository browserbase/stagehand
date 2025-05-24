import { LogLine } from "../../types/log";
import { Stagehand, StagehandFunctionName } from "../index";
import { observe } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { StagehandPage } from "../StagehandPage";
import { drawObserveOverlay } from "../utils";
import { getAccessibilityTree, getCDPFrameId } from "../a11y/utils";
import { AccessibilityNode } from "../../types/context";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Frame } from "@playwright/test";

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

    let iframes: AccessibilityNode[] = [];

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
    const tree = await getAccessibilityTree(this.stagehandPage, this.logger);
    const outputString = tree.simplified;
    iframes = tree.iframes;
    const xpathMap = tree.xpathMap;

    const OUT_ROOT = "out"; // top-level folder (create once)
    mkdirSync(OUT_ROOT, { recursive: true });

    /** Turn a Frame⇢Frame⇢… path into "0/1/0" etc. */
    const makeDirPath = (indices: number[]) => indices.join("/");

    /** Recursively walk the frame tree and persist each frame’s data. */
    const walk = async (
      frame: Frame | undefined, // undefined → main frame
      indexPath: number[] = [], // array of child indices (path to here)
    ): Promise<void> => {
      /* ----------------------------------------------------------- CDP work -- */
      try {
        const tree = await getAccessibilityTree(
          this.stagehandPage,
          this.logger,
          undefined,
          frame,
        );

        /* ---- 1. make /out/0/2/1 … ------------------------------------------ */
        const dir = join(OUT_ROOT, makeDirPath(indexPath));
        mkdirSync(dir, { recursive: true });

        /* ---- 2. write three files ------------------------------------------ */
        writeFileSync(join(dir, "tree.txt"), tree.simplified.trim(), "utf-8");
        writeFileSync(
          join(dir, "xpathMap.json"),
          JSON.stringify(tree.xpathMap, null, 2),
          "utf-8",
        );
        writeFileSync(
          join(dir, "meta.json"),
          JSON.stringify(
            {
              url: (frame ?? this.stagehandPage.page).url(),
              frameId: await getCDPFrameId(this.stagehandPage, frame),
              collectedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          "utf-8",
        );

        this.logger({
          category: "observation",
          message: `wrote AX tree → ${dir}`,
          level: 1,
        });
      } catch (err) {
        this.logger({
          category: "observation",
          message: `⚠️ failed to get AX tree for ${
            frame ? `iframe (${frame.url()})` : "main frame"
          }`,
          level: 1,
          auxiliary: { error: { value: String(err), type: "string" } },
        });
        return; // stop descending this branch
      }

      /* ------------------------------------------------------ recurse ------ */
      const children = (
        frame ?? this.stagehandPage.page.mainFrame()
      ).childFrames();
      for (let i = 0; i < children.length; i++) {
        await walk(children[i], [...indexPath, i]);
      }
    };

    /* kick off from the main document */
    await walk(undefined);

    // No screenshot or vision-based annotation is performed
    const observationResponse = await observe({
      instruction,
      domElements: outputString,
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
    if (iframes.length > 0) {
      iframes.forEach((iframe) => {
        observationResponse.elements.push({
          elementId: Number(iframe.nodeId),
          description: "an iframe",
          method: "not-supported",
          arguments: [],
        });
      });
    }
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

        const xpath = xpathMap[elementId];

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
