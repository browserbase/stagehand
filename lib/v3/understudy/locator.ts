// lib/v3/understudy/locator.ts
import { Protocol } from "devtools-protocol";
import { v3Logger } from "@/lib/v3/logger";
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
  ) {}

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
      await session.send<never>("Runtime.releaseObject", { objectId });
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
        try {
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
        level: 2,
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
      // Create/ensure an isolated world for evaluation
      const { executionContextId } = await session.send<{
        executionContextId: Protocol.Runtime.ExecutionContextId;
      }>("Page.createIsolatedWorld", {
        frameId: this.frame.frameId,
        worldName: "v3-world",
      });

      // Extract the text content from the selector
      let query = raw.replace(/^text=/i, "").trim();
      if (
        (query.startsWith('"') && query.endsWith('"')) ||
        (query.startsWith("'") && query.endsWith("'"))
      ) {
        query = query.slice(1, -1);
      }

      const expr = `(() => {
        const needle = ${JSON.stringify(query)};
        if (!needle) return null;
        try {
          const iter = document.createNodeIterator(document.documentElement, NodeFilter.SHOW_ELEMENT);
          let n;
          while ((n = iter.nextNode())) {
            const el = n;
            const t = (el.innerText ?? el.textContent ?? '').trim();
            if (t && t.includes(needle)) return el;
          }
        } catch {}
        return null;
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
    const expr = `document.querySelector(${JSON.stringify(cssInput)})`;

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
