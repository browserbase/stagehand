import { Protocol } from "devtools-protocol";
import { type CDPSessionLike, isCdpClosedError } from "./cdp.js";
import { Locator } from "./locator.js";
import { type Progress, runLocatorStep } from "./progress.js";
import { executionContexts } from "./executionContextRegistry.js";
import { browserWait, BrowserWaitError } from "./browserWait.js";
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

export class Frame implements FrameManager {
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

  public isBrowserRemote(): boolean {
    return this.remoteBrowser;
  }

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

  async evaluateInLocatorWorld<R = unknown>(
    buildExpression: () => string,
    progress?: Progress,
  ): Promise<R> {
    const response = await this.evaluateLocatorExpression(buildExpression, { progress });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? "Locator-world evaluation failed");
    }
    return response.result.value as R;
  }

  async waitInLocatorWorld(buildExpression: () => string, progress: Progress): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      progress.throwIfStopped();
      let contextId: number | undefined;
      try {
        return await browserWait<boolean>(
          this.session,
          progress,
          async (onLateResult) => {
            const response = await this.evaluateLocatorExpression(buildExpression, {
              progress,
              returnByValue: false,
              awaitPromise: false,
              onLateResult,
            });
            contextId = response.contextId;
            return response;
          },
          "waiting for selector",
        );
      } catch (error) {
        progress.throwIfStopped();
        const message = error instanceof Error ? error.message : String(error);
        if (
          attempt !== 0 ||
          contextId === undefined ||
          error instanceof BrowserWaitError ||
          !message.includes("Cannot find context with specified id")
        )
          throw error;
        executionContexts.unregisterLocatorContext(this.session, contextId);
      }
    }
  }

  private async evaluateLocatorExpression(
    buildExpression: () => string,
    options: {
      progress?: Progress;
      returnByValue?: boolean;
      awaitPromise?: boolean;
      onLateResult?: (response: Protocol.Runtime.EvaluateResponse) => Promise<unknown>;
    },
  ): Promise<Protocol.Runtime.EvaluateResponse & { contextId: number }> {
    const { progress } = options;
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

    const evaluate = () =>
      runLocatorStep(
        progress,
        "evaluating locator helper",
        () =>
          this.session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
            expression: buildExpression(),
            contextId: locatorWorld.contextId,
            awaitPromise: options.awaitPromise ?? true,
            returnByValue: options.returnByValue ?? true,
          }),
        options.onLateResult,
      );

    let response: Protocol.Runtime.EvaluateResponse;
    try {
      response = await evaluate();
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
      response = await evaluate();
    }

    return { ...response, contextId: locatorWorld.contextId };
  }

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

  locator(selector: string, options?: { deep?: boolean; depth?: number }): Locator {
    return new Locator(this, selector, options);
  }

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
