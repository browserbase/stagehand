// lib/v3/understudy/frame.ts
import { Protocol } from "devtools-protocol";
import { type CDPSessionLike, isCdpClosedError } from "./cdp.js";
import { Locator } from "./locator.js";
import { type Progress, runLocatorStep } from "./progress.js";
import { executionContexts } from "./executionContextRegistry.js";
import type { StagehandLogger } from "../logger.js";

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

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
    readonly remoteBrowser: boolean,
    public readonly logger: StagehandLogger,
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

    const { root } = await this.session.send<{ root: Protocol.DOM.Node }>("DOM.getDocument");

    const { nodeId } = await this.session.send<{ nodeId: Protocol.DOM.NodeId }>(
      "DOM.querySelector",
      { nodeId: root.nodeId, selector },
    );

    const { model } = await this.session.send<{ model: Protocol.DOM.BoxModel }>("DOM.getBoxModel", {
      nodeId,
    });

    const x = model.content[0];
    const y = model.content[1];
    const width = model.width;
    const height = model.height;
    return { x, y, width, height };
  }

  /** Read this frame's accessibility tree. */
  async getAccessibilityTree(progress?: Progress): Promise<Protocol.Accessibility.AXNode[]> {
    await runLocatorStep(progress, "enabling accessibility", () =>
      this.session.send("Accessibility.enable"),
    );
    let nodes: Protocol.Accessibility.AXNode[];
    try {
      ({ nodes } = await runLocatorStep(progress, "reading accessibility tree", () =>
        this.session.send<{
          nodes: Protocol.Accessibility.AXNode[];
        }>("Accessibility.getFullAXTree", { frameId: this.frameId }),
      ));
    } catch (e) {
      progress?.throwIfStopped();
      const msg = String((e as Error)?.message ?? e ?? "");
      const isFrameScopeError =
        msg.includes("Frame with the given") ||
        msg.includes("does not belong to the target") ||
        msg.includes("is not found");
      if (!isFrameScopeError) throw e;
      // Retry unscoped: on OOPIF sessions, returns the child doc's AX tree.
      ({ nodes } = await runLocatorStep(progress, "reading accessibility tree", () =>
        this.session.send<{
          nodes: Protocol.Accessibility.AXNode[];
        }>("Accessibility.getFullAXTree"),
      ));
    }

    return nodes;
  }

  /**
   * Evaluate a function or expression in this frame's main world.
   * - If a string is provided, treated as a JS expression.
   * - If a function is provided, it is stringified and invoked with the optional argument.
   * Progress guards dispatch, but issued evaluations are awaited so screenshot
   * restoration cannot run before a late page mutation finishes.
   */
  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
    progress?: Progress,
  ): Promise<R> {
    progress?.throwIfStopped();
    await this.session.send("Runtime.enable").catch(() => {});
    const contextId = await this.getMainWorldExecutionContextId(progress);

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

    let res: Protocol.Runtime.EvaluateResponse;
    try {
      progress?.throwIfStopped();
      res = await this.session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      });
    } catch (error) {
      // Execution contexts can be recreated between context lookup and
      // Runtime.evaluate during popup/navigate churn. Retry once with a fresh id.
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes("Cannot find context with specified id")) throw error;
      const freshContextId = await this.getMainWorldExecutionContextId(progress);
      progress?.throwIfStopped();
      res = await this.session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression,
        contextId: freshContextId,
        awaitPromise: true,
        returnByValue: true,
      });
    }
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text ?? "Evaluation failed");
    }
    return res.result.value as R;
  }

  /** Evaluate an internal expression in Stagehand's selected locator world. */
  async evaluateInLocatorWorld<R = unknown>(expression: string, progress?: Progress): Promise<R> {
    await runLocatorStep(progress, "enabling runtime", () =>
      this.session.send("Runtime.enable").catch((error) => {
        if (progress && isCdpClosedError(error)) throw error;
      }),
    );
    let locatorWorld = await executionContexts.waitForLocatorWorld(
      this.session,
      this.frameId,
      1000,
      progress,
    );

    let response: Protocol.Runtime.EvaluateResponse;
    try {
      response = await runLocatorStep(progress, "evaluating locator helper", () =>
        this.session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression,
          contextId: locatorWorld.contextId,
          awaitPromise: true,
          returnByValue: true,
        }),
      );
    } catch (error) {
      progress?.throwIfStopped();
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Cannot find context with specified id")) throw error;
      executionContexts.unregisterLocatorContext(this.session, locatorWorld.contextId);
      locatorWorld = await executionContexts.waitForLocatorWorld(
        this.session,
        this.frameId,
        1000,
        progress,
      );
      response = await runLocatorStep(progress, "evaluating locator helper", () =>
        this.session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression,
          contextId: locatorWorld.contextId,
          awaitPromise: true,
          returnByValue: true,
        }),
      );
    }

    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? "Locator-world evaluation failed");
    }
    return response.result.value as R;
  }

  /** Page.captureScreenshot (frame-scoped session) */
  async screenshot(
    options: {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      type?: "png" | "jpeg";
      quality?: number;
      scale?: number;
    },
    progress: Progress,
  ): Promise<Uint8Array> {
    // The page bounds the caller's wait. Await actual commands here so the capture
    // lock stays held until Chrome finishes, even after the caller times out.
    progress.throwIfStopped();
    await this.session.send("Page.enable");
    const format = options?.type ?? "png";
    const params: Protocol.Page.CaptureScreenshotRequest & { scale?: number } = {
      format,
      fromSurface: true,
      captureBeyondViewport: options?.fullPage,
    };

    const clampScale = (value: number): number => Math.min(2, Math.max(0.1, value));

    const normalizedScale =
      typeof options?.scale === "number" ? clampScale(options.scale) : undefined;

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

    // Headless Chrome can wait indefinitely for a background tab to produce a frame.
    progress.throwIfStopped();
    await this.session.send("Page.bringToFront");
    progress.throwIfStopped();
    const { data } = await this.session.send<Protocol.Page.CaptureScreenshotResponse>(
      "Page.captureScreenshot",
      params,
    );
    progress.throwIfStopped();
    return base64ToBytes(data);
  }

  /** Wait for a lifecycle state (load/domcontentloaded/networkidle) */
  async waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle" = "load",
    timeout: number = 15_000,
    progress?: Progress,
  ): Promise<void> {
    await runLocatorStep(progress, "enabling load events", () => this.session.send("Page.enable"));
    const targetState = state.toLowerCase();
    const effectiveTimeout = Math.max(0, timeout);
    progress?.throwIfStopped();
    await new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (done) return;
        done = true;
        this.session.off("Page.lifecycleEvent", handler);
        progress?.signal.removeEventListener("abort", finish);
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
      progress?.signal.addEventListener("abort", finish, { once: true });

      timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.session.off("Page.lifecycleEvent", handler);
        progress?.signal.removeEventListener("abort", finish);
        reject(
          new Error(
            `waitForLoadState(${state}) timed out after ${effectiveTimeout}ms for frame ${this.frameId}`,
          ),
        );
      }, effectiveTimeout);
    });
    progress?.throwIfStopped();
  }

  /** Simple placeholder for your own locator abstraction */
  locator(selector: string, options?: { deep?: boolean; depth?: number }): Locator {
    return new Locator(this, selector, options);
  }

  /** Resolve the main-world execution context id for this frame. */
  async getMainWorldExecutionContextId(progress?: Progress): Promise<number> {
    return executionContexts.waitForMainWorld(this.session, this.frameId, 1000, progress);
  }

  async getExtensionWorldExecutionContextId(): Promise<number> {
    return executionContexts.waitForExtensionWorld(this.session, this.frameId, 1000);
  }

  async getLocatorWorldExecutionContextId(): Promise<number> {
    return (await executionContexts.waitForLocatorWorld(this.session, this.frameId, 1000))
      .contextId;
  }
}
