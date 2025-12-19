// lib/v3/understudy/locator.ts
import { Protocol } from "devtools-protocol";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { locatorScriptSources } from "../dom/build/locatorScripts.generated";
import type { Frame } from "./frame";
import { FrameSelectorResolver, type SelectorQuery } from "./selectorResolver";
import {
  StagehandElementNotFoundError,
  StagehandInvalidArgumentError,
  ElementNotVisibleError,
} from "../types/public/sdkErrors";
import { normalizeInputFiles } from "./fileUploadUtils";
import { SetInputFilesArgument } from "../types/public/locator";
import { NormalizedFilePayload } from "../types/private/locator";

const MAX_REMOTE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB guard copied from Playwright

type MouseButton = "left" | "right" | "middle";

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
  private readonly selectorResolver: FrameSelectorResolver;

  private readonly selectorQuery: SelectorQuery;

  private readonly nthIndex: number;

  constructor(
    private readonly frame: Frame,
    private readonly selector: string,
    private readonly options?: { deep?: boolean; depth?: number },
    nthIndex: number = 0,
  ) {
    this.selectorResolver = new FrameSelectorResolver(this.frame);
    this.selectorQuery = FrameSelectorResolver.parseSelector(selector);
    this.nthIndex = Math.max(
      0,
      Math.floor(Number.isFinite(nthIndex) ? nthIndex : 0),
    );
  }

  /** Return the owning Frame for this locator (typed accessor, no private access). */
  public getFrame(): Frame {
    return this.frame;
  }

  /**
   * Set files on an <input type="file"> element.
   *
   * Mirrors Playwright's Locator.setInputFiles basics:
   * - Accepts file path(s) or payload object(s) { name, mimeType, buffer }.
   * - Uses CDP DOM.setFileInputFiles under the hood.
   * - Best‑effort dispatches change/input via CDP (Chrome does by default).
   * - Passing an empty array clears the selection.
   */
  public async setInputFiles(files: SetInputFilesArgument): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    const tempFiles: string[] = [];

    try {
      // Validate element is an <input type="file">
      try {
        const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: locatorScriptSources.ensureFileInputElement,
            returnByValue: true,
          },
        );
        const ok = Boolean(res.result.value);
        if (!ok)
          throw new StagehandInvalidArgumentError(
            'Target is not an <input type="file"> element',
          );
      } catch (e) {
        throw new StagehandInvalidArgumentError(
          e instanceof Error
            ? e.message
            : "Unable to verify file input element",
        );
      }

      const normalized = await normalizeInputFiles(files);

      if (!normalized.length) {
        await session.send<never>("DOM.setFileInputFiles", {
          objectId,
          files: [],
        });
        return;
      }

      if (this.frame.isBrowserRemote()) {
        await this.assignFilesViaPayloadInjection(objectId, normalized);
        return;
      }

      const filePaths: string[] = [];
      for (const payload of normalized) {
        if (payload.absolutePath) {
          filePaths.push(payload.absolutePath);
          continue;
        }
        const ext = path.extname(payload.name);
        const tmp = path.join(
          os.tmpdir(),
          `stagehand-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
        );
        await fs.promises.writeFile(tmp, payload.buffer);
        tempFiles.push(tmp);
        filePaths.push(tmp);
      }

      await session.send<never>("DOM.setFileInputFiles", {
        objectId,
        files: filePaths,
      });
    } finally {
      // Cleanup: release element and remove any temporary files we created
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
      for (const p of tempFiles) {
        try {
          await fs.promises.unlink(p);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Remote browser fallback: build File objects inside the page and attach them via JS.
   *
   * When Stagehand is driving a browser that cannot see the local filesystem (Browserbase,
   * remote CDP, etc.), CDP's DOM.setFileInputFiles would fail because Chrome can't reach
   * our temp files. Instead we base64-encode the payloads, send them into the page, and
   * let a DOM helper create File objects + dispatch change/input events.
   */
  private async assignFilesViaPayloadInjection(
    objectId: Protocol.Runtime.RemoteObjectId,
    files: NormalizedFilePayload[],
  ): Promise<void> {
    const session = this.frame.session;

    for (const payload of files) {
      if (payload.buffer.length > MAX_REMOTE_UPLOAD_BYTES) {
        throw new StagehandInvalidArgumentError(
          `setInputFiles(): file "${payload.name}" is larger than the 50MB limit for remote uploads`,
        );
      }
    }

    const serialized = files.map((payload) => ({
      name: payload.name,
      mimeType: payload.mimeType,
      lastModified: payload.lastModified,
      base64: payload.buffer.toString("base64"),
    }));

    const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration:
          locatorScriptSources.assignFilePayloadsToInputElement,
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
      throw new StagehandInvalidArgumentError(
        "Unable to assign file payloads to remote input element",
      );
    }
  }

  /**
   * Return the DOM backendNodeId for this locator's target element.
   * Useful for identity comparisons without needing element handles.
   */
  async backendNodeId(): Promise<Protocol.DOM.BackendNodeId> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      await session.send("DOM.enable").catch(() => {});
      const { node } = await session.send<{ node: Protocol.DOM.Node }>(
        "DOM.describeNode",
        { objectId },
      );
      return node.backendNodeId as Protocol.DOM.BackendNodeId;
    } finally {
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }

  /** Return how many nodes the current selector resolves to. */
  public async count(): Promise<number> {
    const session = this.frame.session;
    await session.send("Runtime.enable");
    await session.send("DOM.enable");
    return this.selectorResolver.count(this.selectorQuery);
  }

  /**
   * Return the center of the element's bounding box in the owning frame's viewport
   * (CSS pixels), rounded to integers. Scrolls into view best-effort.
   */
  public async centroid(): Promise<{ x: number; y: number }> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      await session
        .send("DOM.scrollIntoViewIfNeeded", { objectId })
        .catch(() => {});
      const box = await session.send<Protocol.DOM.GetBoxModelResponse>(
        "DOM.getBoxModel",
        { objectId },
      );
      if (!box.model) throw new ElementNotVisibleError(this.selector);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);
      return { x: Math.round(cx), y: Math.round(cy) };
    } finally {
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
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
    const contentColor =
      options?.contentColor ?? ({ r: 255, g: 200, b: 0, a: 0.2 } as const);

    try {
      await session.send("Overlay.enable").catch(() => {});
      await session
        .send("DOM.scrollIntoViewIfNeeded", { objectId })
        .catch(() => {});

      // Prefer backendNodeId to keep highlight stable even if objectId is released.
      await session.send("DOM.enable").catch(() => {});
      let backendNodeId: Protocol.DOM.BackendNodeId | undefined;
      try {
        const { node } = await session.send<{ node: Protocol.DOM.Node }>(
          "DOM.describeNode",
          { objectId },
        );
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
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }

  /**
   * Move the mouse cursor to the element's visual center without clicking.
   * - Scrolls into view best-effort, resolves geometry, then dispatches a mouse move.
   */
  async hover(): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      await session
        .send("DOM.scrollIntoViewIfNeeded", { objectId })
        .catch(() => {});

      const box = await session.send<Protocol.DOM.GetBoxModelResponse>(
        "DOM.getBoxModel",
        { objectId },
      );
      if (!box.model) throw new ElementNotVisibleError(this.selector);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);

      await session.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: cx,
        y: cy,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest);
    } finally {
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
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
  async click(options?: {
    button?: MouseButton;
    clickCount?: number;
  }): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    const button = options?.button ?? "left";
    const clickCount = options?.clickCount ?? 1;

    try {
      // Scroll into view using objectId (avoids frontend nodeId dependence)
      await session.send("DOM.scrollIntoViewIfNeeded", { objectId });

      // Get geometry using objectId
      const box = await session.send<Protocol.DOM.GetBoxModelResponse>(
        "DOM.getBoxModel",
        { objectId },
      );
      if (!box.model) throw new ElementNotVisibleError(this.selector);
      const { cx, cy } = this.centerFromBoxContent(box.model.content);

      // Dispatch input (from the same session)
      await session.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: cx,
        y: cy,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest);

      // Dispatch mouse pressed and released events for the given click count
      for (let i = 1; i <= clickCount; i++) {
        await session.send<never>("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: cx,
          y: cy,
          button,
          clickCount: i,
        } as Protocol.Input.DispatchMouseEventRequest);

        await session.send<never>("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: cx,
          y: cy,
          button,
          clickCount: i,
        } as Protocol.Input.DispatchMouseEventRequest);
      }
    } finally {
      // release the element handle
      try {
        await session.send<never>("Runtime.releaseObject", { objectId });
      } catch {
        // If the context navigated or was destroyed (e.g., link opens new tab),
        // releaseObject may fail with -32000. Ignore as best-effort cleanup.
      }
    }
  }

  /**
   * Dispatch a DOM 'click' MouseEvent on the element itself.
   * - Does not synthesize real pointer input; directly dispatches an event.
   * - Useful for elements that rely on click handlers without needing hit-testing.
   */
  async sendClickEvent(options?: {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
    detail?: number;
  }): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    const bubbles = options?.bubbles ?? true;
    const cancelable = options?.cancelable ?? true;
    const composed = options?.composed ?? true;
    const detail = options?.detail ?? 1;
    try {
      await session
        .send("DOM.scrollIntoViewIfNeeded", { objectId })
        .catch(() => {});
      await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.dispatchDomClick,
          arguments: [
            {
              value: { bubbles, cancelable, composed, detail },
            },
          ],
          returnByValue: true,
        },
      );
    } finally {
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }

  /**
   * Scroll the element vertically to a given percentage (0–100).
   * - If the element is <html> or <body>, scrolls the window/document.
   * - Otherwise, scrolls the element itself via element.scrollTo.
   */
  async scrollTo(percent: number | string): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.scrollElementToPercent,
          arguments: [{ value: percent as unknown as number }],
          returnByValue: true,
        },
      );
    } finally {
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }

  /**
   * Fill an input/textarea/contenteditable element.
   * Mirrors Playwright semantics: the DOM helper either applies the native
   * value setter (for special input types) or asks us to type text via the CDP
   * Input domain after focusing/selecting.
   */
  async fill(value: string): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    let releaseNeeded = true;

    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.fillElementValue,
          arguments: [{ value }],
          returnByValue: true,
        },
      );

      const result = res.result.value as
        | { status?: string; reason?: string; value?: string }
        | null
        | undefined;
      const status =
        typeof result === "object" && result ? result.status : undefined;

      if (status === "done") {
        return;
      }

      if (status === "needsinput") {
        // Release the current handle before synthesizing keyboard input to avoid leaking it.
        await session
          .send<never>("Runtime.releaseObject", { objectId })
          .catch(() => {});
        releaseNeeded = false;

        const valueToType =
          typeof result?.value === "string" ? result.value : value;

        let prepared = false;
        try {
          const { objectId: prepObjectId } = await this.resolveNode();
          try {
            const prepRes =
              await session.send<Protocol.Runtime.CallFunctionOnResponse>(
                "Runtime.callFunctionOn",
                {
                  objectId: prepObjectId,
                  functionDeclaration:
                    locatorScriptSources.prepareElementForTyping,
                  returnByValue: true,
                },
              );
            prepared = Boolean(prepRes.result.value);
          } finally {
            await session
              .send<never>("Runtime.releaseObject", { objectId: prepObjectId })
              .catch(() => {});
          }
        } catch {
          // Ignore preparation failures; we'll fall back to typing best-effort.
        }

        if (!prepared && valueToType.length > 0) {
          await this.type(valueToType);
          return;
        }

        if (valueToType.length === 0) {
          // Simulate deleting the currently selected text to clear the field.
          await session.send<never>("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
            nativeVirtualKeyCode: 8,
          } as Protocol.Input.DispatchKeyEventRequest);
          await session.send<never>("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
            nativeVirtualKeyCode: 8,
          } as Protocol.Input.DispatchKeyEventRequest);
        } else {
          await session.send<never>("Input.insertText", { text: valueToType });
        }

        return;
      }

      if (status === "error") {
        const reason =
          typeof result?.reason === "string" && result.reason.length > 0
            ? result.reason
            : "Failed to fill element";
        throw new StagehandInvalidArgumentError(
          `Failed to fill element (${reason})`,
        );
      }

      // Backward compatibility: if no status is returned (older bundle), fall back to setter logic.
      if (!status) {
        await this.type(value);
      }
    } finally {
      if (releaseNeeded) {
        await session
          .send<never>("Runtime.releaseObject", { objectId })
          .catch(() => {});
      }
    }
  }

  /**
   * Type text into the element (focuses first).
   * - Focus via element.focus() in page JS (no DOM.focus(nodeId)).
   * - If no delay, uses `Input.insertText` for efficiency.
   * - With delay, synthesizes `keyDown`/`keyUp` per character.
   */
  async type(text: string, options?: { delay?: number }): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    try {
      // Focus using JS (avoids DOM.focus(nodeId))
      await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.focusElement,
          returnByValue: true,
        },
      );

      if (!options?.delay) {
        await session.send<never>("Input.insertText", { text });
        return;
      }

      for (const ch of text) {
        await session.send<never>("Input.dispatchKeyEvent", {
          type: "keyDown",
          text: ch,
          key: ch,
        } as Protocol.Input.DispatchKeyEventRequest);

        await session.send<never>("Input.dispatchKeyEvent", {
          type: "keyUp",
          text: ch,
          key: ch,
        } as Protocol.Input.DispatchKeyEventRequest);

        await new Promise((r) => setTimeout(r, options.delay));
      }
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Select one or more options on a `<select>` element.
   * Returns the values actually selected after the operation.
   */
  async selectOption(values: string | string[]): Promise<string[]> {
    const session = this.frame.session;
    const desired = Array.isArray(values) ? values : [values];
    const { objectId } = await this.resolveNode();

    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.selectElementOptions,
          arguments: [{ value: desired }],
          returnByValue: true,
        },
      );

      return (res.result.value as string[]) ?? [];
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Return true if the element is attached and visible (rough heuristic).
   */
  async isVisible(): Promise<boolean> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.isElementVisible,
          returnByValue: true,
        },
      );
      return Boolean(res.result.value);
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Return true if the element is an input[type=checkbox|radio] and is checked.
   * Also considers aria-checked for ARIA widgets.
   */
  async isChecked(): Promise<boolean> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.isElementChecked,
          returnByValue: true,
        },
      );
      return Boolean(res.result.value);
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Return the element's input value (for input/textarea/select/contenteditable).
   */
  async inputValue(): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.readElementInputValue,
          returnByValue: true,
        },
      );
      return String(res.result.value ?? "");
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Return the element's textContent (raw, not innerText).
   */
  async textContent(): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.readElementTextContent,
          returnByValue: true,
        },
      );
      return String(res.result.value ?? "");
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Return the element's innerHTML string.
   */
  async innerHtml(): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.readElementInnerHTML,
          returnByValue: true,
        },
      );
      return String(res.result.value ?? "");
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * Return the element's innerText (layout-aware, visible text).
   */
  async innerText(): Promise<string> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();
    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: locatorScriptSources.readElementInnerText,
          returnByValue: true,
        },
      );
      return String(res.result.value ?? "");
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
    }
  }

  /**
   * For API parity, returns the same locator (querySelector already returns the first match).
   */
  first(): Locator {
    return this;
  }

  /** Return a locator narrowed to the element at the given zero-based index. */
  nth(index: number): Locator {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) {
      throw new StagehandInvalidArgumentError(
        "locator().nth() expects a non-negative index",
      );
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
  public async resolveNode(): Promise<{
    nodeId: Protocol.DOM.NodeId | null;
    objectId: Protocol.Runtime.RemoteObjectId;
  }> {
    const session = this.frame.session;

    await session.send("Runtime.enable");
    await session.send("DOM.enable");

    const resolved = await this.selectorResolver.resolveAtIndex(
      this.selectorQuery,
      this.nthIndex,
    );
    if (!resolved) {
      throw new StagehandElementNotFoundError([this.selector]);
    }

    return resolved;
  }

  /** Compute a center point from a BoxModel content quad */
  private centerFromBoxContent(content: number[]): { cx: number; cy: number } {
    // content is [x1,y1, x2,y2, x3,y3, x4,y4]
    if (!content || content.length < 8) {
      throw new StagehandInvalidArgumentError("Invalid box model content quad");
    }
    const xs = [content[0], content[2], content[4], content[6]];
    const ys = [content[1], content[3], content[5], content[7]];
    const cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4;
    const cy = (ys[0] + ys[1] + ys[2] + ys[3]) / 4;
    return { cx, cy };
  }
}
