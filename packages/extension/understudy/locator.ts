// lib/v3/understudy/locator.ts
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
import { FrameSelectorResolver, type SelectorQuery } from "./selectorResolver.js";
import { bytesToBase64, normalizeInputFiles } from "./fileUploadUtils.js";
import type { MouseButton } from "@browserbasehq/stagehand-protocol/types";
import type { SetInputFilesArgument } from "../types/private/fileUpload.js";
import type { NormalizedFilePayload } from "../types/private/locator.js";

const MAX_REMOTE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB guard copied from Playwright

/**
 * Locator
 *
 * Purpose:
 * A small, CDP-based element interaction helper scoped to a specific `Frame`.
 * It resolves a CSS/XPath selector inside the frame’s **isolated world**, and then
 * performs low-level actions (click, type, select) using DOM/Runtime/Input
 * protocol domains with minimal abstraction.
 *
 * Key change:
 * - Prefer **objectId**-based CDP calls (scroll, geometry) to avoid brittle
 *   frontend nodeId mappings. nodeId is resolved on a best-effort basis and
 *   returned for compatibility, but actions do not depend on it.
 *
 * Notes:
 * - Resolution is lazy: every action resolves the selector again.
 * - Uses `Page.createIsolatedWorld` so evaluation is isolated from page scripts.
 * - Releases remote objects (`Runtime.releaseObject`) where appropriate.
 */
export class Locator {
  readonly selectorResolver: FrameSelectorResolver;

  readonly selectorQuery: SelectorQuery;

  // -1 means "no explicit nth()"; default locator resolves to first match for actions.
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

  /** Return the owning Frame for this locator (typed accessor, no private access). */
  public getFrame(): Frame {
    return this.frame;
  }

  /**
   * Set files on an <input type="file"> element.
   *
   * Accepts in-memory payload objects { name, mimeType, buffer } and constructs
   * File objects in the page. Filesystem paths are not available in workers.
   * - Passing an empty array clears the selection.
   */
  public async setInputFiles(files: SetInputFilesArgument): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    try {
      // Validate element is an <input type="file">
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: ensureFileInputElement.toString(),
          returnByValue: true,
        },
      );
      const ok = Boolean(res.result.value);
      if (!ok) throw new TypeError('Target is not an <input type="file"> element');

      const normalized = await normalizeInputFiles(files);

      if (!normalized.length) {
        await this.assignFilesViaPayloadInjection(objectId, []);
        return;
      }

      await this.assignFilesViaPayloadInjection(objectId, normalized);
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }

  /** Build File objects inside the page and attach them via JS. */
  async assignFilesViaPayloadInjection(
    objectId: Protocol.Runtime.RemoteObjectId,
    files: NormalizedFilePayload[],
  ): Promise<void> {
    const session = this.frame.session;

    for (const payload of files) {
      if (payload.bytes.length > MAX_REMOTE_UPLOAD_BYTES) {
        throw new RangeError(
          `setInputFiles(): file "${payload.name}" is larger than the 50MB limit for remote uploads`,
        );
      }
    }

    const serialized = files.map((payload) => ({
      name: payload.name,
      mimeType: payload.mimeType,
      lastModified: payload.lastModified,
      base64: bytesToBase64(payload.bytes),
    }));

    const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: assignFilePayloadsToInputElement.toString(),
        arguments: [
          {
            value: serialized,
          },
        ],
        returnByValue: true,
      },
    );

    const ok = Boolean(res.result?.value);
    if (!ok) {
      throw new Error("Unable to assign file payloads to remote input element");
    }
  }

  /**
   * Return the DOM backendNodeId for this locator's target element.
   * Useful for identity comparisons without needing element handles.
   */
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

  /** Return how many nodes the current selector resolves to. */
  public async count(progress?: Progress): Promise<number> {
    const session = this.frame.session;
    await runLocatorStep(progress, "enabling runtime", () => session.send("Runtime.enable"));
    await runLocatorStep(progress, "enabling DOM", () => session.send("DOM.enable"));
    return this.selectorResolver.count(this.selectorQuery, progress);
  }

  /**
   * Return the center of the element's bounding box in the owning frame's viewport
   * (CSS pixels), rounded to integers. Scrolls into view best-effort.
   */
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

  /**
   * Highlight the element's bounding box using the CDP Overlay domain.
   * - Scrolls element into view best-effort.
   * - Shows a semi-transparent overlay briefly, then hides it.
   */
  public async highlight(options?: {
    durationMs?: number;
    borderColor?: { r: number; g: number; b: number; a?: number };
    contentColor?: { r: number; g: number; b: number; a?: number };
  }): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    const duration = Math.max(0, options?.durationMs ?? 800);

    const borderColor = options?.borderColor ?? { r: 255, g: 0, b: 0, a: 0.9 };
    const contentColor = options?.contentColor ?? ({ r: 255, g: 200, b: 0, a: 0.2 } as const);

    try {
      await session.send("Overlay.enable").catch(() => {});
      await session.send("DOM.scrollIntoViewIfNeeded", { objectId }).catch(() => {});

      // Prefer backendNodeId to keep highlight stable even if objectId is released.
      await session.send("DOM.enable").catch(() => {});
      let backendNodeId: Protocol.DOM.BackendNodeId | undefined;
      try {
        const { node } = await session.send<{ node: Protocol.DOM.Node }>("DOM.describeNode", {
          objectId,
        });
        backendNodeId = node.backendNodeId as Protocol.DOM.BackendNodeId;
      } catch {
        backendNodeId = undefined;
      }

      const highlightConfig: Protocol.Overlay.HighlightConfig = {
        showInfo: false,
        showStyles: false,
        showRulers: false,
        showExtensionLines: false,
        borderColor,
        contentColor,
      } as Protocol.Overlay.HighlightConfig;

      const highlightOnce = async () => {
        await session.send<never>("Overlay.highlightNode", {
          ...(backendNodeId ? { backendNodeId } : { objectId }),
          highlightConfig,
        });
      };

      // Initial draw
      await highlightOnce();

      // Keep alive until duration elapses to resist overlay clears on mouse move/repaints
      if (duration > 0) {
        const start = Date.now();
        const tick = Math.min(300, Math.max(100, Math.floor(duration / 50)));
        while (Date.now() - start < duration) {
          await new Promise((r) => setTimeout(r, tick));
          try {
            await highlightOnce();
          } catch {
            // ignore transient errors
          }
        }
        await session.send<never>("Overlay.hideHighlight").catch(() => {});
      }
    } finally {
      // Releasing objectId should not affect highlight when using backendNodeId.
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }

  /**
   * Move the mouse cursor to the element's visual center without clicking.
   * - Scrolls into view best-effort, resolves geometry, then dispatches a mouse move.
   */
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

  /**
   * Click the element at its visual center.
   * Steps:
   *  1) Resolve selector to { objectId } in the frame world.
   *  2) Scroll into view via `DOM.scrollIntoViewIfNeeded({ objectId })`.
   *  3) Read geometry via `DOM.getBoxModel({ objectId })` → compute a center point.
   *  4) Synthesize mouse press + release via `Input.dispatchMouseEvent`.
   */
  async click(
    options?: { button?: MouseButton; clickCount?: number },
    progress?: Progress,
  ): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);

    const button = options?.button ?? "left";
    const clickCount = options?.clickCount ?? 1;

    try {
      // Scroll into view using objectId (avoids frontend nodeId dependence)
      await runLocatorStep(progress, "scrolling into view", () =>
        session.send("DOM.scrollIntoViewIfNeeded", { objectId }),
      );

      // Get geometry using objectId
      const box = await runLocatorStep(progress, "reading element geometry", () =>
        session.send<Protocol.DOM.GetBoxModelResponse>("DOM.getBoxModel", {
          objectId,
        }),
      );
      if (!box.model) throw new Error(`Element not visible (no box model): ${this.selector}`);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);

      // Dispatch click events in a pipelined burst to reduce inter-click delay
      // from network/CPU jitter between round trips.
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

  /**
   * Dispatch a DOM 'click' MouseEvent on the element itself.
   * - Does not synthesize real pointer input; directly dispatches an event.
   * - Useful for elements that rely on click handlers without needing hit-testing.
   */
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

  /**
   * Scroll the element vertically to a given percentage (0–100).
   * - If the element is <html> or <body>, scrolls the window/document.
   * - Otherwise, scrolls the element itself via element.scrollTo.
   */
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

  /**
   * Fill an input/textarea/contenteditable element.
   * Mirrors Playwright semantics: the DOM helper either applies the native
   * value setter (for special input types) or asks us to type text via the CDP
   * Input domain after focusing/selecting.
   */
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
        // Release the current handle before synthesizing keyboard input to avoid leaking it.
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
          // Ordinary preparation failures can still fall back to typing.
        }

        if (!prepared && valueToType.length > 0) {
          await this.type(valueToType, undefined, progress);
          return;
        }

        if (valueToType.length === 0) {
          // Simulate deleting the currently selected text to clear the field.
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

      // Backward compatibility: if no status is returned (older bundle), fall back to setter logic.
      if (!status) {
        await release();
        await this.type(value, undefined, progress);
      }
    } finally {
      await release();
      progress?.throwIfStopped();
    }
  }

  /**
   * Type text into the element (focuses first).
   * - Focus via element.focus() in page JS (no DOM.focus(nodeId)).
   * - If no delay, uses `Input.insertText` for efficiency.
   * - With delay, synthesizes `keyDown`/`keyUp` per character.
   */
  async type(text: string, options?: { delay?: number }, progress?: Progress): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode(progress);

    try {
      // Focus using JS (avoids DOM.focus(nodeId))
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

  /**
   * Select one or more options on a `<select>` element.
   * Returns the values actually selected after the operation.
   */
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

  /**
   * Return true if the element is attached and visible (rough heuristic).
   */
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

  /**
   * Return true if the element is an input[type=checkbox|radio] and is checked.
   * Also considers aria-checked for ARIA widgets.
   */
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

  /**
   * Return the element's input value (for input/textarea/select/contenteditable).
   */
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

  /**
   * Return the element's textContent (raw, not innerText).
   */
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

  /**
   * Return the element's innerHTML string.
   */
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

  /**
   * Return the element's innerText (layout-aware, visible text).
   */
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

  /**
   * Return a locator narrowed to the first match.
   */
  first(): Locator {
    return this.nth(0);
  }

  /** Return a locator narrowed to the element at the given zero-based index. */
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

  // ---------- helpers ----------

  /**
   * Resolve `this.selector` within the frame to `{ objectId, nodeId? }`:
   * Delegates to a shared selector resolver so all selector logic stays in sync.
   */
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

  /**
   * Resolve all matching nodes for this locator.
   * If the locator is narrowed via nth(), only that index is returned.
   */
  public async resolveNodesForMask(): Promise<
    Array<{
      nodeId: Protocol.DOM.NodeId | null;
      objectId: Protocol.Runtime.RemoteObjectId;
    }>
  > {
    const session = this.frame.session;

    await session.send("Runtime.enable");
    await session.send("DOM.enable");

    if (this.nthIndex >= 0) {
      const resolved = await this.selectorResolver.resolveAtIndex(
        this.selectorQuery,
        this.nthIndex,
      );
      if (!resolved) {
        throw new Error(`Could not find an element for the given xPath(s): ${this.selector}`);
      }
      return [resolved];
    }

    const resolved = await this.selectorResolver.resolveAll(this.selectorQuery);
    if (!resolved.length) {
      throw new Error(`Could not find an element for the given xPath(s): ${this.selector}`);
    }
    return resolved;
  }

  /** Compute a center point from a BoxModel content quad */
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
