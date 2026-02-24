// lib/v3/understudy/frame.ts
import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import { Locator } from "./locator.js";
import { StagehandEvalError } from "../types/public/sdkErrors.js";
import { executionContexts } from "./executionContextRegistry.js";

interface FrameManager {
  session: CDPSessionLike;
  frameId: string;
  pageId: string;
}

/**
 * Frame
 *
 * A thin, session-bound handle to a specific DOM frame (by frameId).
 * All CDP calls in this class go through `this.session`, which MUST be the
 * owning session for `this.frameId`. Page is responsible for constructing
 * Frames with the correct session.
 */
export class Frame implements FrameManager {
  /** Owning CDP session id (useful for logs); null for root connection (should not happen for targets) */
  public readonly sessionId: string | null;

  constructor(
    public session: CDPSessionLike,
    public frameId: string,
    public pageId: string,
    private readonly remoteBrowser: boolean,
  ) {
    this.sessionId = this.session.id ?? null;
  }

  /** True when the controlled browser runs on a different machine. */
  public isBrowserRemote(): boolean {
    return this.remoteBrowser;
  }

  /** DOM.getNodeForLocation → DOM.describeNode */
  async getNodeAtLocation(x: number, y: number): Promise<Protocol.DOM.Node> {
    await this.session.send("DOM.enable");
    const { backendNodeId } = await this.session.send<{
      backendNodeId: Protocol.DOM.BackendNodeId;
    }>("DOM.getNodeForLocation", {
      x,
      y,
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });

    const { node } = await this.session.send<{
      node: Protocol.DOM.Node;
    }>("DOM.describeNode", { backendNodeId });

    return node;
  }

  /** CSS selector → DOM.querySelector → DOM.getBoxModel */
  async getLocationForSelector(
    selector: string,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    await this.session.send("DOM.enable");

    const { root } = await this.session.send<{ root: Protocol.DOM.Node }>(
      "DOM.getDocument",
    );

    const { nodeId } = await this.session.send<{ nodeId: Protocol.DOM.NodeId }>(
      "DOM.querySelector",
      { nodeId: root.nodeId, selector },
    );

    const { model } = await this.session.send<{ model: Protocol.DOM.BoxModel }>(
      "DOM.getBoxModel",
      { nodeId },
    );

    const x = model.content[0];
    const y = model.content[1];
    const width = model.width;
    const height = model.height;
    return { x, y, width, height };
  }

  /** Accessibility.getFullAXTree (+ recurse into child frames if requested) */
  async getAccessibilityTree(
    withFrames = false,
  ): Promise<Protocol.Accessibility.AXNode[]> {
    await this.session.send("Accessibility.enable");
    let nodes: Protocol.Accessibility.AXNode[];
    try {
      ({ nodes } = await this.session.send<{
        nodes: Protocol.Accessibility.AXNode[];
      }>("Accessibility.getFullAXTree", { frameId: this.frameId }));
    } catch (e) {
      const msg = String((e as Error)?.message ?? e ?? "");
      const isFrameScopeError =
        msg.includes("Frame with the given") ||
        msg.includes("does not belong to the target") ||
        msg.includes("is not found");
      if (!isFrameScopeError) throw e;
      // Retry unscoped: on OOPIF sessions, returns the child doc's AX tree.
      ({ nodes } = await this.session.send<{
        nodes: Protocol.Accessibility.AXNode[];
      }>("Accessibility.getFullAXTree"));
    }

    if (!withFrames) return nodes;

    const children = await this.childFrames();
    for (const child of children) {
      const childNodes = await child.getAccessibilityTree(false);
      nodes.push(...childNodes);
    }
    return nodes;
  }

  /**
   * Evaluate a function or expression in this frame's main world.
   * - If a string is provided, treated as a JS expression.
   * - If a function is provided, it is stringified and invoked with the optional argument.
   */
  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    await this.session.send("Runtime.enable").catch(() => {});
    const contextId = await this.getMainWorldExecutionContextId();

    const isString = typeof pageFunctionOrExpression === "string";
    let expression: string;

    if (isString) {
      expression = String(pageFunctionOrExpression);
    } else {
      const fnSrc = pageFunctionOrExpression.toString();
      const argJson = JSON.stringify(arg);
      expression = `(() => {
        const __fn = ${fnSrc};
        const __arg = ${argJson};
        try {
          const __res = __fn(__arg);
          return Promise.resolve(__res).then(v => {
            try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
          });
        } catch (e) { throw e; }
      })()`;
    }

    const res = await this.session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      },
    );
    if (res.exceptionDetails) {
      throw new StagehandEvalError(
        res.exceptionDetails.text ?? "Evaluation failed",
      );
    }
    return res.result.value as R;
  }

  /** Page.captureScreenshot (frame-scoped session) */
  async screenshot(options?: {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
    type?: "png" | "jpeg";
    quality?: number;
    scale?: number;
  }): Promise<Buffer> {
    await this.session.send("Page.enable");
    const format = options?.type ?? "png";
    const params: Protocol.Page.CaptureScreenshotRequest & { scale?: number } =
      {
        format,
        fromSurface: true,
        captureBeyondViewport: options?.fullPage,
      };

    const clampScale = (value: number): number =>
      Math.min(2, Math.max(0.1, value));

    const normalizedScale =
      typeof options?.scale === "number"
        ? clampScale(options.scale)
        : undefined;

    if (options?.clip) {
      const clip = {
        x: options.clip.x,
        y: options.clip.y,
        width: options.clip.width,
        height: options.clip.height,
        scale: normalizedScale ?? 1,
      };
      params.clip = clip;
    } else if (normalizedScale !== undefined && normalizedScale !== 1) {
      params.scale = normalizedScale;
    }

    if (format === "jpeg" && typeof options?.quality === "number") {
      const q = Math.round(options.quality);
      params.quality = Math.min(100, Math.max(0, q));
    }

    const { data } =
      await this.session.send<Protocol.Page.CaptureScreenshotResponse>(
        "Page.captureScreenshot",
        params,
      );
    return Buffer.from(data, "base64");
  }

  /** Child frames via Page.getFrameTree */
  async childFrames(): Promise<Frame[]> {
    const { frameTree } = await this.session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    const frames: Frame[] = [];

    const collect = (tree: Protocol.Page.FrameTree) => {
      if (tree.frame.parentId === this.frameId) {
        frames.push(
          new Frame(
            this.session,
            tree.frame.id,
            this.pageId,
            this.remoteBrowser,
          ),
        );
      }
      tree.childFrames?.forEach(collect);
    };

    collect(frameTree);
    return frames;
  }

  /** Wait for a lifecycle state (load/domcontentloaded/networkidle) */
  async waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle" = "load",
    timeoutMs: number = 15_000,
  ): Promise<void> {
    await this.session.send("Page.enable");
    const targetState = state.toLowerCase();
    const timeout = Math.max(0, timeoutMs);
    await new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (done) return;
        done = true;
        this.session.off("Page.lifecycleEvent", handler);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };
      const handler = (evt: Protocol.Page.LifecycleEventEvent) => {
        const sameFrame = evt.frameId === this.frameId;
        // need to normalize here because CDP lifecycle names look like 'DOMContentLoaded'
        // but we accept 'domcontentloaded'
        const lifecycleName = String(evt.name ?? "").toLowerCase();
        if (sameFrame && lifecycleName === targetState) {
          finish();
        }
      };
      this.session.on("Page.lifecycleEvent", handler);

      timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.session.off("Page.lifecycleEvent", handler);
        reject(
          new Error(
            `waitForLoadState(${state}) timed out after ${timeout}ms for frame ${this.frameId}`,
          ),
        );
      }, timeout);
    });
  }

  /** Simple placeholder for your own locator abstraction */
  locator(
    selector: string,
    options?: { deep?: boolean; depth?: number },
  ): Locator {
    return new Locator(this, selector, options);
  }

  /** Resolve the main-world execution context id for this frame. */
  private async getMainWorldExecutionContextId(): Promise<number> {
    return executionContexts.waitForMainWorld(this.session, this.frameId, 1000);
  }
}
