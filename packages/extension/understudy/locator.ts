import { Protocol } from "devtools-protocol";
import { isCdpClosedError } from "./cdp.js";
import {
  assignFilePayloadsToInputElement,
  dispatchDomClick,
  ensureFileInputElement,
  fillElementValue,
  focusElement,
  isElementChecked,
  isElementVisible,
  prepareElementForTyping,
  readElementInnerHTML,
  readElementInnerText,
  readElementInputValue,
  readElementTextContent,
  scrollElementToPercent,
  selectElementOptions,
} from "../dom/locatorScripts/scripts.js";
import type { Frame } from "./frame.js";
import { type Progress, runLocatorStep } from "./progress.js";
import {
  FrameSelectorResolver,
  type SelectorQuery,
  type ResolvedNodeBatch,
} from "./selectorResolver.js";
import { bytesToBase64, normalizeInputFiles } from "./fileUploadUtils.js";
import type { MouseButton } from "@browserbasehq/stagehand-protocol/types";
import type { SetInputFilesArgument } from "../types/private/fileUpload.js";
import type { NormalizedFilePayload } from "../types/private/locator.js";

const MAX_REMOTE_UPLOAD_BYTES = 50 * 1024 * 1024;

export class Locator {
  readonly selectorResolver: FrameSelectorResolver;

  readonly selectorQuery: SelectorQuery;

  readonly nthIndex: number;

  constructor(
    readonly frame: Frame,
    readonly selector: string,
    readonly options?: { deep?: boolean; depth?: number },
    nthIndex: number = -1,
  ) {
    this.selectorResolver = new FrameSelectorResolver(this.frame);
    this.selectorQuery = FrameSelectorResolver.parseSelector(selector);
    const normalized = Number.isFinite(nthIndex) ? Math.floor(nthIndex) : -1;
    this.nthIndex = normalized < 0 ? -1 : normalized;
  }

  public getFrame(): Frame {
    return this.frame;
  }

  public async setInputFiles(files: SetInputFilesArgument, progress?: Progress): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    let completed = false;

    try {
      const res = await runLocatorStep(progress, "validating file input", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: ensureFileInputElement.toString(),
          returnByValue: true,
        }),
      );
      const ok = Boolean(res.result.value);
      if (!ok) throw new TypeError('Target is not an <input type="file"> element');

      const normalized = await runLocatorStep(progress, "preparing file uploads", () =>
        normalizeInputFiles(files),
      );
      await this.assignFilesViaPayloadInjection(objectId, normalized, progress);
      completed = true;
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress && !completed) void progress.cleanup(release);
      else if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async assignFilesViaPayloadInjection(
    objectId: Protocol.Runtime.RemoteObjectId,
    files: NormalizedFilePayload[],
    progress?: Progress,
  ): Promise<void> {
    const session = this.frame.session;

    const serialized = await runLocatorStep(progress, "encoding file uploads", async () => {
      for (const payload of files) {
        if (payload.bytes.length > MAX_REMOTE_UPLOAD_BYTES) {
          throw new RangeError(
            `setInputFiles(): file "${payload.name}" is larger than the 50MB limit for remote uploads`,
          );
        }
      }
      return files.map((payload) => {
        progress?.throwIfStopped();
        return {
          name: payload.name,
          mimeType: payload.mimeType,
          lastModified: payload.lastModified,
          base64: bytesToBase64(payload.bytes),
        };
      });
    });

    const res = await runLocatorStep(progress, "assigning files", () =>
      session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: assignFilePayloadsToInputElement.toString(),
        arguments: [
          {
            value: serialized,
          },
        ],
        returnByValue: true,
      }),
    );

    const ok = Boolean(res.result?.value);
    if (!ok) {
      throw new Error("Unable to assign file payloads to remote input element");
    }
  }

  async backendNodeId(progress?: Progress): Promise<Protocol.DOM.BackendNodeId> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      await runLocatorStep(progress, "enabling DOM", () =>
        session.send("DOM.enable").catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );
      const { node } = await runLocatorStep(progress, "describing element", () =>
        session.send<{ node: Protocol.DOM.Node }>("DOM.describeNode", {
          objectId,
        }),
      );
      return node.backendNodeId as Protocol.DOM.BackendNodeId;
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  public async count(progress?: Progress): Promise<number> {
    const session = this.frame.session;
    await runLocatorStep(progress, "enabling runtime", () => session.send("Runtime.enable"));
    await runLocatorStep(progress, "enabling DOM", () => session.send("DOM.enable"));
    return this.selectorResolver.count(this.selectorQuery, progress);
  }

  public async centroid(progress?: Progress): Promise<{ x: number; y: number }> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      await runLocatorStep(progress, "scrolling into view", () =>
        session.send("DOM.scrollIntoViewIfNeeded", { objectId }).catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );
      const box = await runLocatorStep(progress, "reading element geometry", () =>
        session.send<Protocol.DOM.GetBoxModelResponse>("DOM.getBoxModel", {
          objectId,
        }),
      );
      if (!box.model) throw new Error(`Element not visible (no box model): ${this.selector}`);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);
      return { x: Math.round(cx), y: Math.round(cy) };
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  public async highlight(
    options?: {
      durationMs?: number;
      borderColor?: { r: number; g: number; b: number; a?: number };
      contentColor?: { r: number; g: number; b: number; a?: number };
    },
    progress?: Progress,
  ): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    const duration = Math.max(0, options?.durationMs ?? 800);
    const borderColor = options?.borderColor ?? { r: 255, g: 0, b: 0, a: 0.9 };
    const contentColor = options?.contentColor ?? ({ r: 255, g: 200, b: 0, a: 0.2 } as const);
    const hide = () => session.send<never>("Overlay.hideHighlight").catch(() => {});
    let completed = false;
    const cleanup = async () => {
      const removeHighlight = duration > 0 || !completed || progress?.remainingMs() === 0;
      const work = () =>
        Promise.all([
          ...(removeHighlight ? [hide()] : []),
          session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {}),
        ]);
      if (progress && !completed) void progress.cleanup(work);
      else if (progress) await progress.cleanup(work);
      else await work();
      try {
        progress?.throwIfStopped();
      } catch (error) {
        if (progress && !removeHighlight) void progress.cleanup(hide);
        throw error;
      }
    };

    try {
      await runLocatorStep(progress, "enabling overlay", () =>
        session.send("Overlay.enable").catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );
      await runLocatorStep(progress, "scrolling into view", () =>
        session.send("DOM.scrollIntoViewIfNeeded", { objectId }).catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );

      // Prefer backendNodeId to keep a persistent highlight after releasing objectId.
      await runLocatorStep(progress, "enabling DOM", () =>
        session.send("DOM.enable").catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );
      let backendNodeId: Protocol.DOM.BackendNodeId | undefined;
      try {
        const { node } = await runLocatorStep(progress, "describing element", () =>
          session.send<{ node: Protocol.DOM.Node }>("DOM.describeNode", { objectId }),
        );
        backendNodeId = node.backendNodeId as Protocol.DOM.BackendNodeId;
      } catch (error) {
        progress?.throwIfStopped();
        if (progress && isCdpClosedError(error)) throw error;
      }

      const highlightConfig: Protocol.Overlay.HighlightConfig = {
        showInfo: false,
        showStyles: false,
        showRulers: false,
        showExtensionLines: false,
        borderColor,
        contentColor,
      } as Protocol.Overlay.HighlightConfig;
      const highlightOnce = () =>
        runLocatorStep(
          progress,
          "highlighting element",
          () =>
            session.send<never>("Overlay.highlightNode", {
              ...(backendNodeId ? { backendNodeId } : { objectId }),
              highlightConfig,
            }),
          hide,
        );

      await highlightOnce();
      if (duration > 0) {
        const now = () => (progress ? performance.now() : Date.now());
        const end = now() + duration;
        const tick = Math.min(300, Math.max(100, Math.floor(duration / 50)));
        while (now() < end) {
          const delay = Math.max(0, Math.min(tick, end - now()));
          if (progress) await progress.delay(delay);
          else await new Promise((resolve) => setTimeout(resolve, delay));
          if (now() >= end) break;
          try {
            await highlightOnce();
          } catch (error) {
            progress?.throwIfStopped();
            if (progress && isCdpClosedError(error)) throw error;
          }
        }
      }
      completed = true;
    } finally {
      await cleanup();
    }
  }

  async hover(progress?: Progress): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      await runLocatorStep(progress, "scrolling into view", () =>
        session.send("DOM.scrollIntoViewIfNeeded", { objectId }).catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );

      const box = await runLocatorStep(progress, "reading element geometry", () =>
        session.send<Protocol.DOM.GetBoxModelResponse>("DOM.getBoxModel", {
          objectId,
        }),
      );
      if (!box.model) throw new Error(`Element not visible (no box model): ${this.selector}`);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);

      await runLocatorStep(progress, "dispatching mouse events", () =>
        session.send<never>("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: cx,
          y: cy,
          button: "none",
        } as Protocol.Input.DispatchMouseEventRequest),
      );
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async click(
    options?: { button?: MouseButton; clickCount?: number },
    progress?: Progress,
  ): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);

    const button = options?.button ?? "left";
    const clickCount = options?.clickCount ?? 1;

    try {
      await runLocatorStep(progress, "scrolling into view", () =>
        session.send("DOM.scrollIntoViewIfNeeded", { objectId }),
      );

      const box = await runLocatorStep(progress, "reading element geometry", () =>
        session.send<Protocol.DOM.GetBoxModelResponse>("DOM.getBoxModel", {
          objectId,
        }),
      );
      if (!box.model) throw new Error(`Element not visible (no box model): ${this.selector}`);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);

      const dispatches: Array<Promise<unknown>> = [];
      dispatches.push(
        runLocatorStep(progress, "dispatching mouse events", () =>
          session.send<never>("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: cx,
            y: cy,
            button: "none",
          } as Protocol.Input.DispatchMouseEventRequest),
        ),
      );

      for (let i = 1; i <= clickCount; i++) {
        dispatches.push(
          runLocatorStep(progress, "dispatching mouse events", () =>
            session.send<never>("Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: cx,
              y: cy,
              button,
              clickCount: i,
            } as Protocol.Input.DispatchMouseEventRequest),
          ),
        );
        dispatches.push(
          runLocatorStep(progress, "dispatching mouse events", () =>
            session.send<never>("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: cx,
              y: cy,
              button,
              clickCount: i,
            } as Protocol.Input.DispatchMouseEventRequest),
          ),
        );
      }
      await Promise.all(dispatches);
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async sendClickEvent(
    options?: {
      bubbles?: boolean;
      cancelable?: boolean;
      composed?: boolean;
      detail?: number;
    },
    progress?: Progress,
  ): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    const bubbles = options?.bubbles ?? true;
    const cancelable = options?.cancelable ?? true;
    const composed = options?.composed ?? true;
    const detail = options?.detail ?? 1;
    try {
      await runLocatorStep(progress, "scrolling into view", () =>
        session.send("DOM.scrollIntoViewIfNeeded", { objectId }).catch((error) => {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );
      await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: dispatchDomClick.toString(),
          arguments: [
            {
              value: { bubbles, cancelable, composed, detail },
            },
          ],
          returnByValue: true,
        }),
      );
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async scrollTo(percent: number | string, progress?: Progress): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: scrollElementToPercent.toString(),
          arguments: [{ value: percent as unknown as number }],
          returnByValue: true,
        }),
      );
    } finally {
      const release = () =>
        session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async fill(value: string, progress?: Progress): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);

    let releaseNeeded = true;
    const release = async () => {
      if (!releaseNeeded) return;
      releaseNeeded = false;
      const work = () => session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(work);
      else await work();
      progress?.throwIfStopped();
    };

    try {
      const res = await runLocatorStep(progress, "filling element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: fillElementValue.toString(),
          arguments: [{ value }],
          returnByValue: true,
        }),
      );
      if (res.exceptionDetails) {
        // prefer exception.description over text (eg "Uncaught")
        const message =
          res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          "Unknown exception during locator().fill()";
        throw new Error(`Error Filling Element with selector: ${this.selector} Reason: ${message}`);
      }

      const result = res.result.value as
        | { status?: string; reason?: string; value?: string }
        | null
        | undefined;
      const status = typeof result === "object" && result ? result.status : undefined;

      if (status === "done") {
        return;
      }

      if (status === "needsinput") {
        await release();

        const valueToType = typeof result?.value === "string" ? result.value : value;

        let prepared = false;
        try {
          const { objectId: prepObjectId } = await this.resolveNode(progress);
          try {
            const prepRes = await runLocatorStep(progress, "preparing text input", () =>
              session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
                objectId: prepObjectId,
                functionDeclaration: prepareElementForTyping.toString(),
                returnByValue: true,
              }),
            );
            prepared = Boolean(prepRes.result.value);
          } finally {
            const releasePrep = () =>
              session
                .send<never>("Runtime.releaseObject", { objectId: prepObjectId })
                .catch(() => {});
            if (progress) await progress.cleanup(releasePrep);
            else await releasePrep();
            progress?.throwIfStopped();
          }
        } catch (error) {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
        }

        if (!prepared && valueToType.length > 0) {
          await this.type(valueToType, undefined, progress);
          return;
        }

        if (valueToType.length === 0) {
          await runLocatorStep(progress, "dispatching keyboard events", () =>
            session.send<never>("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Backspace",
              code: "Backspace",
              windowsVirtualKeyCode: 8,
              nativeVirtualKeyCode: 8,
            } as Protocol.Input.DispatchKeyEventRequest),
          );
          await runLocatorStep(progress, "dispatching keyboard events", () =>
            session.send<never>("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Backspace",
              code: "Backspace",
              windowsVirtualKeyCode: 8,
              nativeVirtualKeyCode: 8,
            } as Protocol.Input.DispatchKeyEventRequest),
          );
        } else {
          await runLocatorStep(progress, "inserting text", () =>
            session.send<never>("Input.insertText", { text: valueToType }),
          );
        }

        return;
      }

      if (status === "error") {
        const reason =
          typeof result?.reason === "string" && result.reason.length > 0
            ? result.reason
            : "Failed to fill element";
        throw new Error(`Failed to fill element (${reason})`);
      }

      if (!status) {
        await release();
        await this.type(value, undefined, progress);
      }
    } finally {
      await release();
      progress?.throwIfStopped();
    }
  }

  async type(text: string, options?: { delay?: number }, progress?: Progress): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);

    try {
      await runLocatorStep(progress, "focusing element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: focusElement.toString(),
          returnByValue: true,
        }),
      );

      if (!options?.delay) {
        await runLocatorStep(progress, "inserting text", () =>
          session.send<never>("Input.insertText", { text }),
        );
        return;
      }

      for (const ch of text) {
        await runLocatorStep(progress, "dispatching keyboard events", () =>
          session.send<never>("Input.dispatchKeyEvent", {
            type: "keyDown",
            text: ch,
            key: ch,
          } as Protocol.Input.DispatchKeyEventRequest),
        );

        await runLocatorStep(progress, "dispatching keyboard events", () =>
          session.send<never>("Input.dispatchKeyEvent", {
            type: "keyUp",
            text: ch,
            key: ch,
          } as Protocol.Input.DispatchKeyEventRequest),
        );

        if (progress) await progress.delay(options.delay);
        else await new Promise((r) => setTimeout(r, options.delay));
      }
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async selectOption(values: string | string[], progress?: Progress): Promise<string[]> {
    const session = this.frame.session;
    const desired = Array.isArray(values) ? values : [values];
    const { objectId } = await this.resolveNode(progress);

    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: selectElementOptions.toString(),
          arguments: [{ value: desired }],
          returnByValue: true,
        }),
      );

      return (res.result.value as string[]) ?? [];
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async isVisible(progress?: Progress): Promise<boolean> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: isElementVisible.toString(),
          returnByValue: true,
        }),
      );
      return Boolean(res.result.value);
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async isChecked(progress?: Progress): Promise<boolean> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: isElementChecked.toString(),
          returnByValue: true,
        }),
      );
      return Boolean(res.result.value);
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async inputValue(progress?: Progress): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: readElementInputValue.toString(),
          returnByValue: true,
        }),
      );
      return String(res.result.value ?? "");
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async textContent(progress?: Progress): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: readElementTextContent.toString(),
          returnByValue: true,
        }),
      );
      return String(res.result.value ?? "");
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async innerHtml(progress?: Progress): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: readElementInnerHTML.toString(),
          returnByValue: true,
        }),
      );
      return String(res.result.value ?? "");
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  async innerText(progress?: Progress): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);
    try {
      const res = await runLocatorStep(progress, "evaluating element", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: readElementInnerText.toString(),
          returnByValue: true,
        }),
      );
      return String(res.result.value ?? "");
    } finally {
      const release = () => session.send<never>("Runtime.releaseObject", { objectId });
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  first(): Locator {
    return this.nth(0);
  }

  nth(index: number): Locator {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("locator().nth() expects a non-negative index");
    }

    const nextIndex = Math.floor(value);
    if (nextIndex === this.nthIndex) {
      return this;
    }

    return new Locator(this.frame, this.selector, this.options, nextIndex);
  }

  public async resolveNode(progress?: Progress): Promise<{
    nodeId: Protocol.DOM.NodeId | null;
    objectId: Protocol.Runtime.RemoteObjectId;
  }> {
    progress?.throwIfStopped();
    const session = this.frame.session;

    await runLocatorStep(progress, "enabling runtime", () => session.send("Runtime.enable"));
    await runLocatorStep(progress, "enabling DOM", () => session.send("DOM.enable"));

    const index = this.nthIndex < 0 ? 0 : this.nthIndex;
    const resolved = await this.selectorResolver.resolveAtIndex(
      this.selectorQuery,
      index,
      progress,
    );
    if (!resolved) {
      throw new Error(`Could not find an element for the given xPath(s): ${this.selector}`);
    }

    return resolved;
  }

  public async resolveNodesForMask(progress: Progress): Promise<ResolvedNodeBatch> {
    const session = this.frame.session;
    await progress.run("enabling runtime", () => session.send("Runtime.enable"));
    await progress.run("enabling DOM", () => session.send("DOM.enable"));
    const options = this.nthIndex >= 0 ? { start: this.nthIndex, limit: 1 } : {};
    const batch = await this.selectorResolver.resolveAll(this.selectorQuery, options, progress);
    if (!batch.nodes.length) {
      await batch.release();
      progress.throwIfStopped();
      throw new Error(`Could not find an element for the given xPath(s): ${this.selector}`);
    }
    return batch;
  }

  centerFromBoxContent(content: number[]): { cx: number; cy: number } {
    // content is [x1,y1, x2,y2, x3,y3, x4,y4]
    if (!content || content.length < 8) {
      throw new Error("Invalid box model content quad");
    }
    const xs = [content[0], content[2], content[4], content[6]];
    const ys = [content[1], content[3], content[5], content[7]];
    const cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4;
    const cy = (ys[0] + ys[1] + ys[2] + ys[3]) / 4;
    return { cx, cy };
  }
}
