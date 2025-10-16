// lib/v3/understudy/locator.ts
import { Protocol } from "devtools-protocol";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Buffer } from "buffer";
import { v3Logger } from "../logger";
import type { Frame } from "./frame";
import { executionContexts } from "./executionContextRegistry";

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
  constructor(
    private readonly frame: Frame,
    private readonly selector: string,
    private readonly options?: { deep?: boolean; depth?: number },
    private readonly nthIndex?: number,
  ) {}

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
  public async setInputFiles(
    files:
      | string
      | string[]
      | {
          name: string;
          mimeType: string;
          buffer: ArrayBuffer | Uint8Array | Buffer | string;
        }
      | Array<{
          name: string;
          mimeType: string;
          buffer: ArrayBuffer | Uint8Array | Buffer | string;
        }>,
  ): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    // Normalize to array
    const items = Array.isArray(files)
      ? (files as unknown[])
      : [files as unknown];

    const tempFiles: string[] = [];
    const filePaths: string[] = [];

    // Helper: normalize various buffer-like inputs to Node Buffer
    const toBuffer = (data: unknown): Buffer => {
      if (Buffer.isBuffer(data)) return data;
      if (data instanceof Uint8Array) return Buffer.from(data);
      if (typeof data === "string") return Buffer.from(data);
      if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
      throw new Error("Unsupported file payload buffer type");
    };

    try {
      // Validate element is an <input type="file">
      try {
        const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration:
              "function(){ try { return (this.tagName||'').toLowerCase()==='input' && String(this.type||'').toLowerCase()==='file'; } catch { return false; } }",
            returnByValue: true,
          },
        );
        const ok = Boolean(res.result.value);
        if (!ok)
          throw new Error('Target is not an <input type="file"> element');
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? e.message
            : "Unable to verify file input element",
        );
      }

      // Build list of absolute file paths, creating temps for payloads
      for (const it of items) {
        if (typeof it === "string") {
          filePaths.push(path.resolve(it));
          continue;
        }
        if (
          it &&
          typeof it === "object" &&
          "name" in it &&
          "mimeType" in it &&
          "buffer" in it
        ) {
          const payload = it as {
            name: string;
            mimeType: string;
            buffer: ArrayBuffer | Uint8Array | Buffer | string;
          };
          const base = payload.name || "upload.bin";
          const ext = path.extname(base);
          const tmp = path.join(
            os.tmpdir(),
            `stagehand-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
          );
          const buf = toBuffer(payload.buffer);
          await fs.promises.writeFile(tmp, buf);
          tempFiles.push(tmp);
          filePaths.push(tmp);
          continue;
        }
        throw new Error(
          "Unsupported setInputFiles item – expected path or payload",
        );
      }

      // Apply files via CDP
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

    const raw = this.selector.trim();
    const looksLikeXPath =
      /^xpath=/i.test(raw) || raw.startsWith("/") || raw.startsWith("(");
    const isTextSelector = /^text=/i.test(raw);
    const isCssPrefixed = /^css=/i.test(raw);

    if (looksLikeXPath) {
      const xp = raw.replace(/^xpath=/i, "");
      return this.countXPathMatches(xp);
    }

    if (isTextSelector) {
      return this.countTextMatches(raw);
    }

    let cssInput = isCssPrefixed ? raw.replace(/^css=/i, "") : raw;
    if (cssInput.includes(">>")) {
      cssInput = cssInput
        .split(">>")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
    }

    return this.countCssMatches(cssInput.trim());
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
      if (!box.model) throw new Error("Element not visible (no box model)");
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
      if (!box.model) throw new Error("Element not visible (no box model)");
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
      if (!box.model) throw new Error("Element not visible (no box model)");
      const { cx, cy } = this.centerFromBoxContent(box.model.content);

      // Dispatch input (from the same session)
      await session.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: cx,
        y: cy,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest);

      await session.send<never>("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: cx,
        y: cy,
        button,
        clickCount,
      } as Protocol.Input.DispatchMouseEventRequest);

      await session.send<never>("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: cx,
        y: cy,
        button,
        clickCount,
      } as Protocol.Input.DispatchMouseEventRequest);
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
          functionDeclaration: `
            function(opts) {
              try {
                const ev = new MouseEvent('click', {
                  bubbles: !!opts?.bubbles,
                  cancelable: !!opts?.cancelable,
                  composed: !!opts?.composed,
                  detail: (typeof opts?.detail === 'number' ? opts.detail : 1),
                  view: this?.ownerDocument?.defaultView || window
                });
                this.dispatchEvent(ev);
              } catch (e) {
                try { this.click(); } catch {}
              }
            }
          `,
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
          functionDeclaration: `
            function(pct) {
              function normalize(v) {
                if (typeof v === 'number') return Math.max(0, Math.min(v, 100));
                const s = String(v).trim();
                const n = parseFloat(s.replace('%',''));
                return Number.isNaN(n) ? 0 : Math.max(0, Math.min(n, 100));
              }
              const yPct = normalize(pct);
              const tag = this.tagName?.toLowerCase();

              if (tag === 'html' || tag === 'body') {
                const root = document.scrollingElement || document.documentElement || document.body;
                const scrollHeight = root.scrollHeight || document.body.scrollHeight;
                const viewportHeight = window.innerHeight;
                const maxTop = Math.max(0, (scrollHeight - viewportHeight));
                const top = maxTop * (yPct / 100);
                window.scrollTo({ top, left: window.scrollX, behavior: 'smooth' });
                return true;
              }

              const scrollHeight = this.scrollHeight ?? 0;
              const clientHeight = this.clientHeight ?? 0;
              const maxTop = Math.max(0, (scrollHeight - clientHeight));
              const top = maxTop * (yPct / 100);
              this.scrollTo({ top, left: this.scrollLeft ?? 0, behavior: 'smooth' });
              return true;
            }
          `,
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
   * - Sets the value/text directly in DOM.
   * - Dispatches `input` and `change` events to mimic user input.
   * - Releases the underlying `objectId` afterwards to avoid leaks.
   */
  async fill(value: string): Promise<void> {
    const session = this.frame.session;
    const { objectId } = await this.resolveNode();

    try {
      await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: `
            function(v) {
              if ('value' in this) this.value = v;
              else if (this.isContentEditable) this.textContent = v;
              this.dispatchEvent(new Event('input', { bubbles: true }));
              this.dispatchEvent(new Event('change', { bubbles: true }));
            }
          `,
          arguments: [{ value }],
          returnByValue: true,
        },
      );
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId });
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
          functionDeclaration: `function(){ try { this.focus(); } catch {} }`,
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
          functionDeclaration: `
            function(vals) {
              if (!this || !this.tagName || this.tagName.toLowerCase() !== 'select') {
                return [];
              }

              const arr = Array.isArray(vals) ? vals : [vals];
              // Normalise desired tokens (match either label/text or value exactly)
              const wanted = new Set(arr.map(v => String(v ?? '').trim()));

              const matches = (opt) => {
                const label = (opt.label || opt.textContent || '').trim();
                const value = String(opt.value ?? '').trim();
                return wanted.has(label) || wanted.has(value);
              };

              if (this.multiple) {
                for (const opt of this.options) {
                  opt.selected = matches(opt);
                }
              } else {
                let chosen = false;
                for (const opt of this.options) {
                  if (!chosen && matches(opt)) {
                    opt.selected = true;
                    // Ensure <select>.value reflects the chosen option
                    this.value = opt.value;
                    chosen = true;
                  } else {
                    opt.selected = false;
                  }
                }
              }

              this.dispatchEvent(new Event('input', { bubbles: true }));
              this.dispatchEvent(new Event('change', { bubbles: true }));
              return Array.from(this.selectedOptions).map(o => o.value);
            }
          `,
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
          functionDeclaration: `function() {
            try {
              if (!this.isConnected) return false;
              const style = window.getComputedStyle(this);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
              const rect = this.getBoundingClientRect();
              if (!rect) return false;
              if (Math.max(rect.width, rect.height) === 0) return false;
              // Check that it has at least one box (accounts for some SVG/text cases)
              if (this.getClientRects().length === 0) return false;
              return true;
            } catch { return false; }
          }`,
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
          functionDeclaration: `function() {
            try {
              const tag = (this.tagName || '').toLowerCase();
              if (tag === 'input') {
                const t = (this.type || '').toLowerCase();
                if (t === 'checkbox' || t === 'radio') return !!this.checked;
              }
              const aria = this.getAttribute && this.getAttribute('aria-checked');
              if (aria != null) return aria === 'true';
              return false;
            } catch { return false; }
          }`,
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
          functionDeclaration: `function() {
            try {
              const tag = (this.tagName || '').toLowerCase();
              if (tag === 'input' || tag === 'textarea') return String(this.value ?? '');
              if (tag === 'select') return String(this.value ?? '');
              if (this.isContentEditable) return String(this.textContent ?? '');
              return '';
            } catch { return ''; }
          }`,
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
          functionDeclaration: `function() { try { return String(this.textContent ?? ''); } catch { return ''; } }`,
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
          functionDeclaration: `function() { try { return String(this.innerHTML ?? ''); } catch { return ''; } }`,
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
          functionDeclaration: `function() { try { return String(this.innerText ?? this.textContent ?? ''); } catch { return ''; } }`,
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

  /**
   * Returns a locator that will match the nth element (0-based index).
   * For example, locator("button").nth(1) will match the second button.
   */
  nth(index: number): Locator {
    return new Locator(this.frame, this.selector, this.options, index);
  }

  // ---------- helpers ----------

  /**
   * Resolve `this.selector` within the frame to `{ objectId, nodeId? }`:
   * - Ensures Runtime/DOM are enabled.
   * - Creates (or reuses) an isolated world for this frame.
   * - Evaluates a CSS or XPath query in that isolated world.
   * - Best-effort: attempts to convert `objectId` to `nodeId`; failure is non-fatal.
   *
   * - For XPath: first try page-side resolver (__stagehandV3__.resolveSimpleXPath).
   *   If it returns null (e.g. closed DSD not captured), fall back to CDP DOM with
   *   `pierce: true` to traverse closed shadow roots and resolve by backendNodeId.
   */
  public async resolveNode(): Promise<{
    nodeId: Protocol.DOM.NodeId | null;
    objectId: Protocol.Runtime.RemoteObjectId;
  }> {
    const session = this.frame.session;

    await session.send("Runtime.enable");
    await session.send("DOM.enable");

    const raw = this.selector.trim();
    const looksLikeXPath =
      /^xpath=/i.test(raw) || raw.startsWith("/") || raw.startsWith("(");
    const isCssPrefixed = /^css=/i.test(raw);
    const isTextSelector = /^text=/i.test(raw);

    if (looksLikeXPath) {
      // main world (needed for closed shadow)
      const ctxId = await executionContexts.waitForMainWorld(
        session,
        this.frame.frameId,
        1000,
      );

      const xp = raw.replace(/^xpath=/i, "");
      v3Logger({
        category: "locator",
        message: "xpath main-world",
        level: 2,
        auxiliary: {
          frameId: { value: String(this.frame.frameId), type: "string" },
          xp: { value: xp, type: "string" },
          ctxId: { value: String(ctxId), type: "string" },
        },
      });

      // Try page-side resolver first (fast path for open/closed via attachShadow)
      const expr = `(function () {
        const xp = ${JSON.stringify(xp)};
        const nthIndex = ${JSON.stringify(this.nthIndex ?? null)};
        try {
          if (nthIndex !== null && typeof nthIndex === 'number') {
            // For nth() we need to get all results and return the nth one
            const result = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (nthIndex >= 0 && nthIndex < result.snapshotLength) {
              return result.snapshotItem(nthIndex);
            }
            return null;
          }
          if (window.__stagehandV3__ && typeof window.__stagehandV3__.resolveSimpleXPath === "function") {
            return window.__stagehandV3__.resolveSimpleXPath(xp);
          }
          // Fallback to native XPath (will NOT cross closed shadow boundaries)
          return document
            .evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
            .singleNodeValue;
        } catch { return null; }
      })()`;

      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: false,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        throw new Error(evalRes.exceptionDetails.text ?? "Evaluation failed");
      }

      // If page-side resolver found it, return immediately
      if (evalRes.result.objectId) {
        const objectId = evalRes.result.objectId;
        let nodeId: Protocol.DOM.NodeId | null = null;
        try {
          const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
            "DOM.requestNode",
            { objectId },
          );
          nodeId = rn.nodeId ?? null;
        } catch {
          nodeId = null;
        }
        return { nodeId, objectId };
      }

      // Page-side resolver failed — likely a closed DSD (never hit attachShadow).
      // Fall back to CDP DOM traversal with pierce: true.
      v3Logger({
        category: "locator",
        message: "xpath pierce-fallback",
        level: 1,
        auxiliary: {
          frameId: { value: String(this.frame.frameId), type: "string" },
          xp: { value: xp, type: "string" },
        },
      });

      const fallback = await this.resolveViaDomPierceXPath(xp);
      if (!fallback) {
        v3Logger({
          category: "locator",
          message: "xpath not found",
          level: 2,
          auxiliary: {
            frameId: { value: String(this.frame.frameId), type: "string" },
            xp: { value: xp, type: "string" },
          },
        });
        throw new Error(`Element not found for selector: ${this.selector}`);
      }

      const { objectId, backendNodeId } = fallback;

      let nodeId: Protocol.DOM.NodeId | null = null;
      try {
        const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
          "DOM.requestNode",
          { objectId },
        );
        nodeId = rn.nodeId ?? null;
      } catch {
        nodeId = null;
      }

      v3Logger({
        category: "locator",
        message: "xpath pierce-fallback hit",
        level: 2,
        auxiliary: {
          frameId: { value: String(this.frame.frameId), type: "string" },
          backendNodeId: { value: String(backendNodeId), type: "string" },
        },
      });

      return { nodeId, objectId };
    }

    // Text selector branch (search by visible text)
    if (isTextSelector) {
      let query = raw.replace(/^text=/i, "").trim();
      if (
        (query.startsWith('"') && query.endsWith('"')) ||
        (query.startsWith("'") && query.endsWith("'"))
      ) {
        query = query.slice(1, -1);
      }

      const ctxId = await executionContexts.waitForMainWorld(
        session,
        this.frame.frameId,
        1000,
      );

      const expr = `(() => {
        const needleRaw = ${JSON.stringify(query)};
        if (!needleRaw) return null;
        const needle = String(needleRaw);
        const needleLc = needle.toLowerCase();

        const skipTags = new Set([
          'SCRIPT',
          'STYLE',
          'TEMPLATE',
          'NOSCRIPT',
          'HEAD',
          'TITLE',
          'LINK',
          'META',
          'HTML',
          'BODY',
        ]);

        const shouldSkip = (node) => {
          const tag = (node?.tagName || '').toUpperCase();
          return skipTags.has(tag);
        };

        const extractText = (node) => {
          try {
            if (shouldSkip(node)) return '';
            const inner = node.innerText;
            if (typeof inner === 'string' && inner.trim()) return inner.trim();
          } catch {}
          try {
            const txt = node.textContent;
            if (typeof txt === 'string') return txt.trim();
          } catch {}
          return '';
        };

        const backdoor = window.__stagehandV3__;
        const getClosedRoot =
          backdoor && typeof backdoor.getClosedRoot === 'function'
            ? (host) => {
                try {
                  return backdoor.getClosedRoot(host) || null;
                } catch {
                  return null;
                }
              }
            : () => null;

        const seen = new WeakSet();
        const queue = [];
        const enqueue = (root) => {
          if (!root || seen.has(root)) return;
          seen.add(root);
          queue.push(root);
        };

        const walkerFor = (root) => {
          try {
            const doc =
              root instanceof Document ? root : root?.ownerDocument ?? document;
            return doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          } catch {
            return null;
          }
        };

        const matches = (element) => {
          const text = extractText(element);
          return text && text.toLowerCase().includes(needleLc);
        };

        enqueue(document);
        const matchesList = [];

        while (queue.length) {
          const root = queue.shift();
          if (!root) continue;

          if (root instanceof Element && matches(root)) {
            matchesList.push(root);
          }

          const walker = walkerFor(root);
          if (!walker) continue;

          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!(node instanceof Element)) continue;

            if (matches(node)) {
              matchesList.push(node);
            }

            const open = node.shadowRoot;
            if (open) enqueue(open);

            const closed = getClosedRoot(node);
            if (closed) enqueue(closed);
          }
        }

        if (!matchesList.length) return null;

        const nthIndex = ${JSON.stringify(this.nthIndex ?? null)};
        
        // If nth index is specified, return the nth element from matchesList
        if (nthIndex !== null && typeof nthIndex === 'number') {
          if (nthIndex >= 0 && nthIndex < matchesList.length) {
            return matchesList[nthIndex];
          }
          return null;
        }

        for (const candidate of matchesList) {
          let contained = false;
          for (const other of matchesList) {
            if (candidate === other) continue;
            if (candidate.contains(other)) {
              contained = true;
              break;
            }
          }
          if (!contained) {
            return candidate;
          }
        }

        return matchesList[matchesList.length - 1] ?? null;
      })()`;

      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: false,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        throw new Error(evalRes.exceptionDetails.text ?? "Evaluation failed");
      }

      const objectId = evalRes.result.objectId;
      if (!objectId) {
        throw new Error(`Element not found for selector: ${this.selector}`);
      }

      let nodeId: Protocol.DOM.NodeId | null = null;
      try {
        const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
          "DOM.requestNode",
          { objectId },
        );
        nodeId = rn.nodeId ?? null;
      } catch {
        nodeId = null;
      }

      return { nodeId, objectId };
    }

    // CSS branch (isolated world is fine)
    const { executionContextId } = await session.send<{
      executionContextId: Protocol.Runtime.ExecutionContextId;
    }>("Page.createIsolatedWorld", {
      frameId: this.frame.frameId,
      worldName: "v3-world",
    });

    // Basic support for Playwright-style chaining '>>' by converting to a descendant CSS selector.
    // Example: "#licenseType >> option:checked" → "#licenseType option:checked"
    let cssInput = isCssPrefixed ? raw.replace(/^css=/i, "") : raw;
    if (cssInput.includes(">>")) {
      cssInput = cssInput
        .split(">>")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
    }
    const expr = `(() => {
    const selector = ${JSON.stringify(cssInput)};
    const nthIndex = ${JSON.stringify(this.nthIndex ?? null)};
    
    function queryDeepAll(root, results = []) {
      // Try in this root
      try {
        const hits = root.querySelectorAll(selector);
        results.push(...hits);
      } catch {}

      // Walk elements and descend into open shadow roots
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
          queryDeepAll(node.shadowRoot, results);
        }
      }
      return results;
    }
    
    if (nthIndex !== null && typeof nthIndex === 'number') {
      const allMatches = queryDeepAll(document);
      if (nthIndex >= 0 && nthIndex < allMatches.length) {
        return allMatches[nthIndex];
      }
      return null;
    }
    
    function queryDeepFirst(root) {
      // Try in this root
      try {
        const hit = root.querySelector(selector);
        if (hit) return hit;
      } catch {}

      // Walk elements and descend into open shadow roots
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
          const found = queryDeepFirst(node.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    }
    return queryDeepFirst(document);
})()`;

    const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: expr,
        contextId: executionContextId,
        returnByValue: false,
        awaitPromise: true,
      },
    );

    if (evalRes.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.text ?? "Evaluation failed");
    }

    const objectId = evalRes.result.objectId;
    if (!objectId) {
      // Fallback: main-world deep search including CLOSED shadow roots via v3 backdoor
      const ctxId = await executionContexts.waitForMainWorld(
        session,
        this.frame.frameId,
        1000,
      );

      v3Logger({
        category: "locator",
        message: "css pierce-fallback",
        level: 2,
        auxiliary: {
          frameId: { value: String(this.frame.frameId), type: "string" },
          selector: { value: cssInput, type: "string" },
        },
      });

      const exprPierce = `(() => {
        const selector = ${JSON.stringify(cssInput)};
        const nthIndex = ${JSON.stringify(this.nthIndex ?? null)};
        const backdoor = window.__stagehandV3__;
        // If our v3 script isn't present, bail
        if (!backdoor || typeof backdoor.getClosedRoot !== 'function') return null;

        function* roots() {
          yield document;
          const queue = [];

          // Seed: discover all open/closed roots reachable from document
          try {
            const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
            let n;
            while ((n = walker.nextNode())) {
              const el = n;
              if (el.shadowRoot) queue.push(el.shadowRoot);
              try {
                const closed = backdoor.getClosedRoot(el);
                if (closed) queue.push(closed);
              } catch {}
            }
          } catch {}

          while (queue.length) {
            const root = queue.shift();
            yield root;
            try {
              const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
              let e;
              while ((e = w.nextNode())) {
                const el = e;
                if (el.shadowRoot) queue.push(el.shadowRoot);
                try {
                  const closed = backdoor.getClosedRoot(el);
                  if (closed) queue.push(closed);
                } catch {}
              }
            } catch {}
          }
        }

        if (nthIndex !== null && typeof nthIndex === 'number') {
          const allMatches = [];
          for (const r of roots()) {
            try {
              const hits = r.querySelectorAll(selector);
              allMatches.push(...hits);
            } catch {}
          }
          if (nthIndex >= 0 && nthIndex < allMatches.length) {
            return allMatches[nthIndex];
          }
          return null;
        }

        for (const r of roots()) {
          try {
            const hit = r.querySelector(selector);
            if (hit) return hit;
          } catch {}
        }
        return null;
      })()`;

      const pierceRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: exprPierce,
          contextId: ctxId,
          returnByValue: false,
          awaitPromise: true,
        },
      );

      if (pierceRes.exceptionDetails) {
        throw new Error(pierceRes.exceptionDetails.text ?? "Evaluation failed");
      }

      const obj2 = pierceRes.result.objectId;
      if (!obj2) {
        throw new Error(`Element not found for selector: ${this.selector}`);
      }

      let nodeId2: Protocol.DOM.NodeId | null = null;
      try {
        const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
          "DOM.requestNode",
          { objectId: obj2 },
        );
        nodeId2 = rn.nodeId ?? null;
      } catch {
        nodeId2 = null;
      }

      return { nodeId: nodeId2, objectId: obj2 };
    }

    let nodeId: Protocol.DOM.NodeId | null = null;
    try {
      const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
        "DOM.requestNode",
        { objectId },
      );
      nodeId = rn.nodeId ?? null;
    } catch {
      nodeId = null;
    }

    return { nodeId, objectId };
  }

  /**
   * CDP fallback for XPath resolution that needs to cross *closed* shadow roots
   * created via Declarative Shadow DOM (no attachShadow call to intercept).
   *
   * Strategy:
   *   - Fetch full DOM with `pierce: true` so closed shadow roots are included.
   *   - Run a small, tolerant XPath stepper over the CDP node tree:
   *       • supports absolute paths like `/html/body/...`
   *       • supports `//` descendant jumps
   *       • supports `tag[n]` numeric predicates per sibling group
   *       • supports `*`
   *   - Resolve the winning backendNodeId to an objectId for downstream actions.
   */
  private async countCssMatches(selector: string): Promise<number> {
    const session = this.frame.session;

    if (!selector) return 0;

    const normalise = (value: unknown): number => {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    };

    let primaryCount = 0;
    try {
      const { executionContextId } = await session.send<{
        executionContextId: Protocol.Runtime.ExecutionContextId;
      }>("Page.createIsolatedWorld", {
        frameId: this.frame.frameId,
        worldName: "v3-world",
      });

      const expr = `(() => {
        const selector = ${JSON.stringify(selector)};
        if (!selector) return 0;
        const seen = new WeakSet();
        const visit = (root) => {
          if (!root || seen.has(root)) return 0;
          seen.add(root);
          let total = 0;
          try {
            total += root.querySelectorAll(selector).length;
          } catch {}
          try {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node;
            while ((node = walker.nextNode())) {
              const el = node;
              if (el.shadowRoot) total += visit(el.shadowRoot);
            }
          } catch {}
          return total;
        };
        try {
          return visit(document);
        } catch {
          try {
            return document.querySelectorAll(selector).length;
          } catch {
            return 0;
          }
        }
      })()`;

      const primaryEval = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: executionContextId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (!primaryEval.exceptionDetails) {
        primaryCount = normalise(primaryEval.result.value);
      }
    } catch {
      primaryCount = 0;
    }

    let fallbackCount = 0;
    try {
      const ctxId = await executionContexts.waitForMainWorld(
        session,
        this.frame.frameId,
        1000,
      );

      const exprPierce = `(() => {
        const selector = ${JSON.stringify(selector)};
        if (!selector) return 0;
        const backdoor = window.__stagehandV3__;
        if (!backdoor || typeof backdoor.getClosedRoot !== 'function') {
          try {
            return document.querySelectorAll(selector).length;
          } catch {
            return 0;
          }
        }

        const seen = new WeakSet();
        const queue = [];
        const enqueue = (root) => {
          if (!root || seen.has(root)) return;
          seen.add(root);
          queue.push(root);
        };

        enqueue(document);
        let total = 0;
        while (queue.length) {
          const root = queue.shift();
          try {
            total += root.querySelectorAll(selector).length;
          } catch {}

          try {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node;
            while ((node = walker.nextNode())) {
              const el = node;
              if (el.shadowRoot) enqueue(el.shadowRoot);
              try {
                const closed = backdoor.getClosedRoot(el);
                if (closed) enqueue(closed);
              } catch {}
            }
          } catch {}
        }

        return total;
      })()`;

      const fallbackEval =
        await session.send<Protocol.Runtime.EvaluateResponse>(
          "Runtime.evaluate",
          {
            expression: exprPierce,
            contextId: ctxId,
            returnByValue: true,
            awaitPromise: true,
          },
        );

      if (!fallbackEval.exceptionDetails) {
        fallbackCount = normalise(fallbackEval.result.value);
      }
    } catch {
      fallbackCount = 0;
    }

    return Math.max(primaryCount, fallbackCount);
  }

  private async countTextMatches(raw: string): Promise<number> {
    const session = this.frame.session;

    let query = raw.replace(/^text=/i, "").trim();
    if (
      (query.startsWith('"') && query.endsWith('"')) ||
      (query.startsWith("'") && query.endsWith("'"))
    ) {
      query = query.slice(1, -1);
    }

    if (!query) return 0;

    const normalise = (value: unknown): number => {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    };

    try {
      const ctxId = await executionContexts.waitForMainWorld(
        session,
        this.frame.frameId,
        1000,
      );

      const expr = `(() => {
        const needle = ${JSON.stringify(query)};
        if (!needle) return { count: 0, sample: [], error: null };

        const needleLc = String(needle).toLowerCase();

        const backdoor = window.__stagehandV3__;
        const getClosedRoot =
          backdoor && typeof backdoor.getClosedRoot === 'function'
            ? (host) => {
                try {
                  return backdoor.getClosedRoot(host) || null;
                } catch {
                  return null;
                }
              }
            : () => null;

        const seen = new WeakSet();
        const queue = [];
        const enqueue = (root) => {
          if (!root || seen.has(root)) return;
          seen.add(root);
          queue.push(root);
        };

        const skipTags = new Set([
          'SCRIPT',
          'STYLE',
          'TEMPLATE',
          'NOSCRIPT',
          'HEAD',
          'TITLE',
          'LINK',
          'META',
          'HTML',
          'BODY',
        ]);

        const extractText = (el) => {
          try {
            const tag = (el.tagName ?? '').toUpperCase();
            if (skipTags.has(tag)) return '';

            const inner = el.innerText;
            if (typeof inner === 'string' && inner.trim()) return inner.trim();

            const fallback = el.textContent;
            if (typeof fallback === 'string') return fallback.trim();
          } catch {}
          return '';
        };

        const matches = (el) => {
          const text = extractText(el);
          return text && text.toLowerCase().includes(needleLc);
        };

        const walkerFor = (root) => {
          try {
            const doc =
              root instanceof Document ? root : root?.ownerDocument ?? document;
            return doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          } catch {
            return null;
          }
        };

        enqueue(document);
        const found = [];

        while (queue.length) {
          const root = queue.shift();
          if (!root) continue;

          if (root instanceof Element && matches(root)) {
            found.push({
              element: root,
              tag: root.tagName ?? '',
              id: root.id ?? '',
              className: root.className ?? '',
              text: extractText(root),
            });
          }

          const walker = walkerFor(root);
          if (!walker) continue;

          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!(node instanceof Element)) continue;

            if (matches(node)) {
              found.push({
                element: node,
                tag: node.tagName ?? '',
                id: node.id ?? '',
                className: node.className ?? '',
                text: extractText(node),
              });
            }

            const open = node.shadowRoot;
            if (open) enqueue(open);

            const closed = getClosedRoot(node);
            if (closed) enqueue(closed);
          }
        }

        const innermost = [];
        for (const item of found) {
          const el = item.element;
          let skip = false;
          for (const other of found) {
            if (item === other) continue;
            if (el.contains(other.element)) {
              skip = true;
              break;
            }
          }
          if (!skip) {
            innermost.push(item);
          }
        }

        const count = innermost.length;
        const sample = innermost.slice(0, 5).map((item) => ({
          tag: item.tag,
          id: item.id,
          class: item.className,
          text: item.text,
        }));

        return { count, sample, error: null };
      })()`;

      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        const details = evalRes.exceptionDetails;
        v3Logger({
          category: "locator",
          message: "count text evaluate exception",
          level: 0,
          auxiliary: {
            frameId: { value: String(this.frame.frameId), type: "string" },
            selector: { value: this.selector, type: "string" },
            query: { value: query, type: "string" },
            exception: {
              value:
                details.text ??
                String(
                  details.exception?.description ??
                    details.exception?.value ??
                    "",
                ),
              type: "string",
            },
          },
        });
        return 0;
      }

      const data = (evalRes.result.value ?? {}) as {
        count?: unknown;
        sample?: unknown;
        error?: unknown;
      };

      return normalise((data?.count as number | string | undefined) ?? 0);
    } catch {
      // fall through to return 0
    }
    return 0;
  }

  private async countXPathMatches(raw: string): Promise<number> {
    const session = this.frame.session;
    const xp = raw.trim();
    if (!xp) return 0;

    const normalise = (value: unknown): number => {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    };

    try {
      const ctxId = await executionContexts.waitForMainWorld(
        session,
        this.frame.frameId,
        1000,
      );

      const expr = `(() => {
        const xp = ${JSON.stringify(xp)};
        if (!xp) return 0;

        const parseSteps = (input) => {
          const s = String(input || '').trim();
          if (!s) return [];
          const path = s.replace(/^xpath=/i, '');
          const steps = [];
          let i = 0;
          while (i < path.length) {
            let axis = 'child';
            if (path.startsWith('//', i)) {
              axis = 'desc';
              i += 2;
            } else if (path[i] === '/') {
              axis = 'child';
              i += 1;
            }
            const start = i;
            while (i < path.length && path[i] !== '/') i++;
            const rawStep = path.slice(start, i).trim();
            if (!rawStep) continue;
            const m = rawStep.match(/^(.*?)(\\[(\\d+)\\])?$/u);
            const base = (m?.[1] ?? rawStep).trim();
            const index = m?.[3] ? Math.max(1, Number(m[3])) : null;
            const tag = base === '' ? '*' : base.toLowerCase();
            steps.push({ axis, tag, index });
          }
          return steps;
        };

        const steps = parseSteps(xp);
        if (!steps.length) return 0;

        const backdoor = window.__stagehandV3__;
        const getClosedRoot =
          backdoor && typeof backdoor.getClosedRoot === 'function'
            ? (host) => {
                try {
                  return backdoor.getClosedRoot(host) || null;
                } catch {
                  return null;
                }
              }
            : () => null;

        const composedChildren = (node) => {
          const out = [];
          if (!node) return out;
          if (node instanceof Document) {
            if (node.documentElement) out.push(node.documentElement);
            return out;
          }
          if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
            out.push(...Array.from(node.children ?? []));
            return out;
          }
          if (node instanceof Element) {
            out.push(...Array.from(node.children ?? []));
            const open = node.shadowRoot;
            if (open) out.push(...Array.from(open.children ?? []));
            const closed = getClosedRoot(node);
            if (closed) out.push(...Array.from(closed.children ?? []));
            return out;
          }
          return out;
        };

        const composedDescendants = (node) => {
          const out = [];
          const seen = new Set();
          const queue = [...composedChildren(node)];
          while (queue.length) {
            const next = queue.shift();
            if (!next || seen.has(next)) continue;
            seen.add(next);
            out.push(next);
            queue.push(...composedChildren(next));
          }
          return out;
        };

        let current = [document];
        for (const step of steps) {
          const next = [];
          const added = new Set();
          for (const root of current) {
            if (!root) continue;
            const pool =
              step.axis === 'child'
                ? composedChildren(root)
                : composedDescendants(root);
            if (!pool || !pool.length) continue;

            const matches = [];
            for (const candidate of pool) {
              if (!(candidate instanceof Element)) continue;
              if (step.tag !== '*' && candidate.localName !== step.tag) continue;
              matches.push(candidate);
            }

            if (step.index != null) {
              const idx0 = step.index - 1;
              const chosen = idx0 >= 0 && idx0 < matches.length ? matches[idx0] : null;
              if (chosen && !added.has(chosen)) {
                added.add(chosen);
                next.push(chosen);
              }
            } else {
              for (const candidate of matches) {
                if (!added.has(candidate)) {
                  added.add(candidate);
                  next.push(candidate);
                }
              }
            }
          }

          if (!next.length) return 0;
          current = next;
        }

        return current.length;
      })()`;

      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (!evalRes.exceptionDetails) {
        return normalise(evalRes.result.value);
      }
    } catch {
      // fall through to DOM snapshot fallback
    }

    return this.countViaDomPierceXPath(xp);
  }

  private async countViaDomPierceXPath(xp: string): Promise<number> {
    const s = this.frame.session;

    await s.send("DOM.enable").catch(() => {});
    const doc = await s.send<Protocol.DOM.GetDocumentResponse>(
      "DOM.getDocument",
      {
        depth: -1,
        pierce: true,
      },
    );

    const root = doc.root;
    if (!root) return 0;

    const raw = String(xp || "").trim();
    if (!raw) return 0;

    const parts = raw.split("/");

    type NodeT = Protocol.DOM.Node;

    const isElement = (n: NodeT) => n.nodeType === 1;
    const isShadowRoot = (n: NodeT) =>
      n.nodeName === "#document-fragment" || n.nodeName === "#shadow-root";

    const childrenOf = (n: NodeT): NodeT[] => {
      const out: NodeT[] = [];
      if (Array.isArray(n.children)) out.push(...(n.children as NodeT[]));
      if (Array.isArray(n.shadowRoots)) {
        for (const sr of n.shadowRoots as NodeT[]) {
          if (sr && Array.isArray(sr.children)) {
            out.push(sr as NodeT);
          }
        }
      }
      return out;
    };

    const allDescendants = (nodes: NodeT[]): NodeT[] => {
      const out: NodeT[] = [];
      const q = [...nodes];
      while (q.length) {
        const cur = q.shift()!;
        const kids = childrenOf(cur);
        for (const k of kids) {
          out.push(k);
          q.push(k);
          if (isShadowRoot(k) && Array.isArray(k.children)) {
            for (const c of k.children as NodeT[]) {
              out.push(c);
              q.push(c);
            }
          }
        }
      }
      return out;
    };

    const parseStep = (step: string): { tag: string; index?: number } => {
      const m = /^([a-zA-Z*-][a-zA-Z0-9\-_]*)?(?:\[(\d+)])?$/.exec(step.trim());
      if (!m) return { tag: "*" };
      const tag = (m[1] ?? "*").toLowerCase();
      const index = m[2] ? parseInt(m[2], 10) : undefined;
      return { tag, index };
    };

    let current: NodeT[] = [root];
    let descendant = false;

    for (let i = 1; i < parts.length; i++) {
      const step = parts[i];
      if (step === "") {
        descendant = true;
        continue;
      }

      const { tag, index } = parseStep(step);
      const tagUpper = tag === "*" ? "*" : tag.toUpperCase();

      const next: NodeT[] = [];

      for (const c of current) {
        const pool = descendant ? allDescendants([c]) : childrenOf(c);

        const expanded: NodeT[] = [];
        for (const n of pool) {
          if (isShadowRoot(n)) {
            expanded.push(...childrenOf(n));
          } else {
            expanded.push(n);
          }
        }

        if (index !== undefined) {
          let count = 0;
          for (const n of expanded) {
            if (isElement(n) && (tagUpper === "*" || n.nodeName === tagUpper)) {
              count++;
              if (count === index) {
                next.push(n);
                break;
              }
            }
          }
        } else {
          for (const n of expanded) {
            if (isElement(n) && (tagUpper === "*" || n.nodeName === tagUpper)) {
              next.push(n);
            }
          }
        }
      }

      if (!next.length) {
        return 0;
      }

      descendant = false;
      current = next;
    }

    const matches = current.filter(
      (n) => isElement(n) && n.backendNodeId != null,
    );
    return matches.length;
  }

  private async resolveViaDomPierceXPath(xp: string): Promise<{
    objectId: Protocol.Runtime.RemoteObjectId;
    backendNodeId: Protocol.DOM.BackendNodeId;
  } | null> {
    const s = this.frame.session;

    await s.send("DOM.enable").catch(() => {});
    // depth: -1 → entire tree; pierce: true → include closed/open shadow roots
    const doc = await s.send<Protocol.DOM.GetDocumentResponse>(
      "DOM.getDocument",
      {
        depth: -1,
        pierce: true,
      },
    );

    const root = doc.root;
    if (!root) return null;

    // Tokenize: keep '' tokens to represent `//`
    const raw = String(xp || "").trim();
    const parts = raw.split("/"); // e.g. ["", "html", "body", "shadow-demo", "", "div", "button"]

    type NodeT = Protocol.DOM.Node;

    const isElement = (n: NodeT) => n.nodeType === 1;
    const isShadowRoot = (n: NodeT) =>
      n.nodeName === "#document-fragment" || n.nodeName === "#shadow-root";

    const childrenOf = (n: NodeT): NodeT[] => {
      const out: NodeT[] = [];
      // Standard DOM children
      if (Array.isArray(n.children)) out.push(...(n.children as NodeT[]));

      // Shadow roots off an element host
      if (Array.isArray(n.shadowRoots)) {
        for (const sr of n.shadowRoots as NodeT[]) {
          if (sr && Array.isArray(sr.children)) {
            out.push(sr as NodeT); // include the shadow root node itself so we can descend
          }
        }
      }
      // For shadow root nodes, continue via their children
      if (isShadowRoot(n) && Array.isArray(n.children)) {
        // (already included above if we treat SR as a node that has children)
      }
      return out;
    };

    const allDescendants = (nodes: NodeT[]): NodeT[] => {
      const out: NodeT[] = [];
      const q = [...nodes];
      while (q.length) {
        const cur = q.shift()!;
        const kids = childrenOf(cur);
        for (const k of kids) {
          out.push(k);
          q.push(k);
          // If the child is a shadow root node, also enqueue its children directly
          if (isShadowRoot(k) && Array.isArray(k.children)) {
            for (const c of k.children as NodeT[]) {
              out.push(c);
              q.push(c);
            }
          }
        }
      }
      return out;
    };

    const parseStep = (step: string): { tag: string; index?: number } => {
      const m = /^([a-zA-Z*-][a-zA-Z0-9\-_]*)?(?:\[(\d+)])?$/.exec(step.trim());
      if (!m) return { tag: "*" };
      const tag = (m[1] ?? "*").toLowerCase();
      const index = m[2] ? parseInt(m[2], 10) : undefined;
      return { tag, index };
    };

    let current: NodeT[] = [root];
    let descendant = false;

    for (let i = 1; i < parts.length; i++) {
      const step = parts[i];
      if (step === "") {
        // Encountered `//` — next named step will be a descendant search
        descendant = true;
        continue;
      }

      const { tag, index } = parseStep(step);
      const tagUpper = tag === "*" ? "*" : tag.toUpperCase();

      const next: NodeT[] = [];

      // For each current node, pick either immediate children or all descendants
      for (const c of current) {
        const pool = descendant ? allDescendants([c]) : childrenOf(c);

        // Special: if pool contains shadow root nodes, descend through them too
        const expanded: NodeT[] = [];
        for (const n of pool) {
          if (isShadowRoot(n)) {
            expanded.push(...childrenOf(n)); // jump into SR children
          } else {
            expanded.push(n);
          }
        }

        if (index !== undefined) {
          // numeric predicate: choose the nth element of that tag among this parent's pool
          let count = 0;
          for (const n of expanded) {
            if (isElement(n) && (tagUpper === "*" || n.nodeName === tagUpper)) {
              count++;
              if (count === index) {
                next.push(n);
                break; // nth per parent
              }
            }
          }
        } else {
          for (const n of expanded) {
            if (isElement(n) && (tagUpper === "*" || n.nodeName === tagUpper)) {
              next.push(n);
            }
          }
        }
      }

      if (!next.length) {
        return null;
      }

      // Reset descendant flag after consuming a named step
      descendant = false;
      // Choose the next frontier
      current = next;
    }

    // Final selection: first in tree order
    const hit = current.find((n) => isElement(n));
    if (!hit || hit.backendNodeId == null) return null;

    const resolved = await s.send<Protocol.DOM.ResolveNodeResponse>(
      "DOM.resolveNode",
      { backendNodeId: hit.backendNodeId },
    );
    const objectId = resolved.object?.objectId;
    if (!objectId) return null;

    return { objectId, backendNodeId: hit.backendNodeId };
  }

  /** Compute a center point from a BoxModel content quad */
  private centerFromBoxContent(content: number[]): { cx: number; cy: number } {
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
