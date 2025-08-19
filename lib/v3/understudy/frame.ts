import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp"; // <- use our session interface

interface FrameManager {
  session: CDPSessionLike;
  frameId: string;
  pageId: string;
}

// Optional stub to satisfy locator() return type
class Locator {
  constructor(
    private frame: Frame,
    private selector: string,
    private options?: { deep?: boolean; depth?: number },
  ) {}
}

export class Frame implements FrameManager {
  constructor(
    public session: CDPSessionLike,
    public frameId: string,
    public pageId: string,
  ) {}

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

  /** Wait for DOM to settle via MutationObserver inside an isolated world */
  async waitForSettledDom(timeout = 30_000): Promise<boolean> {
    const contextId = await this.getExecutionContextId();

    const evalRes = await this.session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: `
          new Promise((resolve) => {
            let timer = setTimeout(() => resolve(true), ${timeout});
            const observer = new MutationObserver(() => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                observer.disconnect();
                resolve(true);
              }, 500);
            });
            observer.observe(document, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
          })
        `,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      },
    );

    if (evalRes.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.text ?? "Evaluation failed");
    }
    return Boolean(evalRes.result.value);
  }

  /** Accessibility.getFullAXTree (+ recurse into child frames if requested) */
  async getAccessibilityTree(
    withFrames = false,
  ): Promise<Protocol.Accessibility.AXNode[]> {
    await this.session.send("Accessibility.enable");
    const { nodes } = await this.session.send<{
      nodes: Protocol.Accessibility.AXNode[];
    }>("Accessibility.getFullAXTree", { frameId: this.frameId });

    if (!withFrames) return nodes;

    const children = await this.childFrames();
    for (const child of children) {
      const childNodes = await child.getAccessibilityTree(false);
      nodes.push(...childNodes);
    }
    return nodes;
  }

  /** Runtime.evaluate in the frame’s isolated world */
  async evaluate<T = unknown>(
    expression: string,
    ...args: unknown[]
  ): Promise<T> {
    const contextId = await this.getExecutionContextId();
    const res = await this.session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression,
        contextId,
        awaitPromise: true,
        returnByValue: true,
        arguments: args.map((value) => ({ value })),
      },
    );
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text ?? "Evaluation failed");
    }
    return res.result.value as T;
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
