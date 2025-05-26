import { LogLine } from "../../types/log";
import { Stagehand, StagehandFunctionName } from "../index";
import { observe } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { StagehandPage } from "../StagehandPage";
import { drawObserveOverlay } from "../utils";
import { getAccessibilityTree, getCDPFrameId } from "../a11y/utils";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { Frame } from "@playwright/test";

export class StagehandObserveHandler {
  private readonly stagehand: Stagehand;
  private readonly logger: (logLine: LogLine) => void;
  private readonly stagehandPage: StagehandPage;
  private readonly debugOutput: boolean;

  private readonly userProvidedInstructions?: string;
  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
    debugOutput = false,
  }: {
    stagehand: Stagehand;
    logger: (logLine: LogLine) => void;
    stagehandPage: StagehandPage;
    userProvidedInstructions?: string;
    debugOutput?: boolean;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
    if (debugOutput) mkdirSync("out", { recursive: true });
  }

  private writeDebug(relPath: string, data: string): void {
    if (!this.debugOutput) return;
    const abs = join("out", relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data, "utf-8");
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

    const getFrameRootBackendNodeId = async (
      stagehandPage: StagehandPage,
      frame: Frame | undefined,
    ): Promise<number | null> => {
      if (!frame) return null;

      const cdp = await stagehandPage.page
        .context()
        .newCDPSession(stagehandPage.page);
      const frameId = await getCDPFrameId(stagehandPage, frame);

      // Let Playwright infer the raw type, then cast to a narrow interface.
      const result = (await cdp.send("DOM.getFrameOwner", {
        frameId,
      })) as FrameOwnerResult;

      return result.backendNodeId ?? null;
    };

    const getFrameRootXpath = async (
      frame: Frame | undefined,
    ): Promise<string> => {
      if (!frame) return "/";
      const handle = await frame.frameElement();
      return handle.evaluate((node: Element) => {
        const pos = (el: Element) => {
          let i = 1;
          for (
            let sib = el.previousElementSibling;
            sib;
            sib = sib.previousElementSibling
          )
            if (sib.tagName === el.tagName) i += 1;
          return i;
        };
        const segs: string[] = [];
        for (let el: Element | null = node; el; el = el.parentElement)
          segs.unshift(`${el.tagName.toLowerCase()}[${pos(el)}]`);
        return `/${segs.join("/")}`;
      });
    };

    const snapshots: FrameSnapshot[] = [];

    const walk = async (frame: Frame | undefined, idxPath: number[] = []) => {
      try {
        const tree = await getAccessibilityTree(
          this.stagehandPage,
          this.logger,
          undefined,
          frame,
        );

        const frameXpath = await getFrameRootXpath(frame);
        const backendNodeId = await getFrameRootBackendNodeId(
          this.stagehandPage,
          frame,
        );

        // keep everything in memory
        snapshots.push({
          tree: tree.simplified.trimEnd(),
          xpathMap: tree.xpathMap,
          frameXpath,
          backendNodeId,
        });

        // debug dump (optional)
        const dbgDir = idxPath.join("/");
        this.writeDebug(join(dbgDir, "tree.txt"), tree.simplified.trim());
        this.writeDebug(
          join(dbgDir, "xpathMap.json"),
          JSON.stringify(tree.xpathMap, null, 2),
        );
        this.writeDebug(
          join(dbgDir, "meta.json"),
          JSON.stringify(
            {
              url: (frame ?? this.stagehandPage.page).url(),
              frameId: await getCDPFrameId(this.stagehandPage, frame),
              collectedAt: new Date().toISOString(),
              xpath: frameXpath,
              backendNodeId,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        this.logger({
          category: "observation",
          message: `⚠️ failed to get AX tree for ${
            frame ? `iframe (${frame.url()})` : "main frame"
          }`,
          level: 1,
          auxiliary: { error: { value: String(err), type: "string" } },
        });
        return;
      }

      for (const [i, child] of (frame ?? this.stagehandPage.page.mainFrame())
        .childFrames()
        .entries()) {
        await walk(child, [...idxPath, i]);
      }
    };

    await this.stagehandPage._waitForSettledDom();
    await walk(undefined);

    const combinedXpathMap: Record<number, string> = {};
    for (const snap of snapshots) {
      const prefix = snap.frameXpath === "/" ? "" : snap.frameXpath;
      for (const [idStr, local] of Object.entries(snap.xpathMap)) {
        const full =
          prefix + (local.startsWith("/") || !prefix ? "" : "/") + local;
        combinedXpathMap[Number(idStr)] = full;
      }
    }
    this.writeDebug(
      "combinedXpathMap.json",
      JSON.stringify(combinedXpathMap, null, 2),
    );

    const idToTree = new Map<number, string>();
    snapshots.forEach((s) => {
      if (s.backendNodeId != null) idToTree.set(s.backendNodeId, s.tree);
    });

    const inject = (t: string): string =>
      t.replace(/^(\s*)\[(\d+)](.*)$/gm, (line, ws: string, idStr: string) => {
        const child = idToTree.get(+idStr);
        if (!child) return line;
        const indented = inject(child)
          .split("\n")
          .map((l) => `${ws}  ${l}`)
          .join("\n");
        return `${line}\n${indented}`;
      });

    const root = snapshots.find((s) => s.frameXpath === "/");
    const combinedTree = root ? inject(root.tree) : "";

    this.writeDebug("combinedTree.txt", combinedTree);

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

        const xpath = combinedXpathMap[elementId];

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

interface FrameSnapshot {
  tree: string;
  xpathMap: Record<number, string>;
  frameXpath: string;
  backendNodeId: number | null;
}

interface FrameOwnerResult {
  backendNodeId?: number;
}
