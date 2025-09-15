// lib/v3/understudy/frame.ts
import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { Locator } from "./locator";

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
  ) {
    this.sessionId = this.session.id ?? null;
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
    let nodes: Protocol.Accessibility.AXNode[] = [];
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
   * Evaluate a function or expression in this frame's isolated world.
   * - If a string is provided, treated as a JS expression.
   * - If a function is provided, it is stringified and invoked with the optional argument.
   */
  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    await this.session.send("Runtime.enable").catch(() => {});
    const contextId = await this.getExecutionContextId();

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
      throw new Error(res.exceptionDetails.text ?? "Evaluation failed");
    }
    return res.result.value as R;
  }

  /** Page.captureScreenshot (frame-scoped session) */
  async screenshot(options?: {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<string> {
    await this.session.send("Page.enable");
    const params: Protocol.Page.CaptureScreenshotRequest = {
      format: "png",
      captureBeyondViewport: options?.fullPage,
    };
    if (options?.clip) params.clip = { ...options.clip, scale: 1 };
    const { data } =
      await this.session.send<Protocol.Page.CaptureScreenshotResponse>(
        "Page.captureScreenshot",
        params,
      );
    return data;
  }

  /** Child frames via Page.getFrameTree */
  async childFrames(): Promise<Frame[]> {
    const { frameTree } = await this.session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    const frames: Frame[] = [];

    const collect = (tree: Protocol.Page.FrameTree) => {
      if (tree.frame.parentId === this.frameId) {
        frames.push(new Frame(this.session, tree.frame.id, this.pageId));
      }
      tree.childFrames?.forEach(collect);
    };

    collect(frameTree);
    return frames;
  }

  /** Wait for a lifecycle state (load/domcontentloaded/networkidle) */
  async waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle" = "load",
  ): Promise<void> {
    await this.session.send("Page.enable");
    await new Promise<void>((resolve) => {
      const handler = (evt: Protocol.Page.LifecycleEventEvent) => {
        if (evt.frameId === this.frameId && evt.name === state) {
          this.session.off("Page.lifecycleEvent", handler);
          resolve();
        }
      };
      this.session.on("Page.lifecycleEvent", handler);
    });
  }

  /** Simple placeholder for your own locator abstraction */
  locator(
    selector: string,
    options?: { deep?: boolean; depth?: number },
  ): Locator {
    return new Locator(this, selector, options);
  }

  /** Create/get an isolated world for this frame and return its executionContextId */
  private async getExecutionContextId(): Promise<number> {
    await this.session.send("Page.enable");
    await this.session.send("Runtime.enable");
    const { executionContextId } = await this.session.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId: this.frameId,
      worldName: "v3-world",
    });
    return executionContextId;
  }
}
