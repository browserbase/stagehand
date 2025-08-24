import { Protocol } from "devtools-protocol";
import { Frame } from "./frame";

type MouseButton = "left" | "right" | "middle";

/**
 * Locator
 *
 * Purpose:
 * A small, CDP-based element interaction helper scoped to a specific `Frame`.
 * It resolves a CSS selector inside the frame’s **isolated world**, and then
 * performs low-level actions (click, type, select) using DOM / Runtime / Input
 * protocol domains with minimal abstraction.
 *
 * Notes:
 * - Resolution is lazy: each action resolves the selector to a node/object.
 * - Uses `Page.createIsolatedWorld` so evaluation is isolated from page scripts.
 * - Avoids retaining remote objects (releases objectIds where appropriate).
 */
export class Locator {
  constructor(
    private readonly frame: Frame,
    private readonly selector: string,
    private readonly options?: { deep?: boolean; depth?: number },
  ) {}

  /**
   * Click the element at its visual center.
   * Steps:
   *  1) Resolve selector to { nodeId }.
   *  2) Ensure it’s visible via `DOM.scrollIntoViewIfNeeded`.
   *  3) Read content quads → compute center point.
   *  4) Synthesize mouse press + release via `Input.dispatchMouseEvent`.
   */
  async click(options?: {
    button?: MouseButton;
    clickCount?: number;
  }): Promise<void> {
    const { nodeId } = await this.resolveNode();
    const session = this.frame.session;

    await session.send("DOM.scrollIntoViewIfNeeded", { nodeId });

    const { quads } = await session.send<Protocol.DOM.GetContentQuadsResponse>(
      "DOM.getContentQuads",
      { nodeId },
    );
    if (!quads || quads.length === 0)
      throw new Error("Element not visible (no content quads)");

    const [cx, cy] = this.centerOfQuad(quads[0]);

    const button = options?.button ?? "left";
    const clickCount = options?.clickCount ?? 1;

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
  }

  /**
   * Fill an input/textarea/contenteditable element.
   * - Sets the value/text directly in DOM.
   * - Dispatches `input` and `change` events to mimic user input.
   * - Releases the underlying `objectId` afterwards to avoid leaks.
   */
  async fill(value: string): Promise<void> {
    const { objectId } = await this.resolveNode();
    const session = this.frame.session;

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
   * - If no delay, uses `Input.insertText` for efficiency.
   * - With delay, synthesizes `keyDown`/`keyUp` per character.
   */
  async type(text: string, options?: { delay?: number }): Promise<void> {
    const { nodeId } = await this.resolveNode();
    const session = this.frame.session;

    await session.send("DOM.focus", { nodeId });

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
  }

  /**
   * Select one or more options on a `<select>` element.
   * Returns the values actually selected after the operation.
   */
  async selectOption(values: string | string[]): Promise<string[]> {
    const desired = Array.isArray(values) ? values : [values];
    const { objectId } = await this.resolveNode();
    const session = this.frame.session;

    try {
      const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: `
          function(vals) {
            if (this && this.tagName === 'SELECT') {
              const set = new Set(vals);
              for (const opt of this.options) {
                opt.selected = set.has(opt.value);
              }
              this.dispatchEvent(new Event('input', { bubbles: true }));
              this.dispatchEvent(new Event('change', { bubbles: true }));
              return Array.from(this.selectedOptions).map(o => o.value);
            }
            return [];
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

  // ---------- helpers ----------

  /**
   * Resolve `this.selector` within the frame to `{ nodeId, objectId }`:
   * - Ensures Runtime/DOM domains are enabled.
   * - Creates (or reuses) an isolated world for this frame.
   * - Evaluates `document.querySelector(selector)` in that world.
   * - Converts the resulting `objectId` to a `nodeId` for DOM methods.
   */
  private async resolveNode(): Promise<{
    nodeId: Protocol.DOM.NodeId;
    objectId: Protocol.Runtime.RemoteObjectId;
  }> {
    const session = this.frame.session;

    // Ensure domains
    await session.send("Runtime.enable");
    await session.send("DOM.enable");

    // Create/obtain isolated world for the frame
    const { executionContextId } = await session.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId: this.frame.frameId,
      worldName: "v3-world",
    });

    // Evaluate querySelector in that context
    const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: `document.querySelector(${JSON.stringify(this.selector)})`,
        contextId: executionContextId,
        returnByValue: false, // we want an objectId, not a value copy
        awaitPromise: true,
      },
    );

    if (evalRes.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.text ?? "Evaluation failed");
    }
    const objId = evalRes.result.objectId;
    if (!objId)
      throw new Error(`Element not found for selector: ${this.selector}`);

    // Convert objectId → nodeId for DOM.* methods
    const { nodeId } = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
      "DOM.requestNode",
      {
        objectId: objId,
      },
    );

    return { nodeId, objectId: objId };
  }

  /**
   * Compute the center of a quad `[x1,y1,x2,y2,x3,y3,x4,y4]`.
   * Used to derive a reasonable click point from `DOM.getContentQuads`.
   */
  private centerOfQuad(quad: number[]): [number, number] {
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4;
    const cy = (ys[0] + ys[1] + ys[2] + ys[3]) / 4;
    return [cx, cy];
  }
}
