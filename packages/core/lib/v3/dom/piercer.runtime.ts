export interface V3ShadowPatchOptions {
  debug?: boolean;
  tagExisting?: boolean;
}

export interface StagehandV3Backdoor {
  /** Closed shadow-root accessors */
  getClosedRoot(host: Element): ShadowRoot | undefined;
  /** Stats + quick health check */
  stats(): {
    installed: true;
    url: string;
    isTop: boolean;
    open: number;
    closed: number;
  };
  /** Simple composed-tree resolver (axis '/', '//' and trailing [n] only; no iframe hops) */
  resolveSimpleXPath(xp: string): Element | null;
}

type V3InternalState = {
  hostToRoot: WeakMap<Element, ShadowRoot>;
  openCount: number;
  closedCount: number;
  debug: boolean;
};

declare global {
  interface Window {
    __stagehandV3Injected?: boolean;
    __stagehandV3__?: StagehandV3Backdoor;
  }
}

export function installV3ShadowPiercer(opts: V3ShadowPatchOptions = {}): void {
  // hardcoded debug (remove later if desired)
  const DEBUG = true;

  type PatchedFn = Element["attachShadow"] & {
    __v3Patched?: boolean;
    __v3State?: V3InternalState;
  };

  const bindBackdoor = (state: V3InternalState): void => {
    const { hostToRoot } = state;

    const composedChildren = (node: Node): ReadonlyArray<Element> => {
      const out: Element[] = [];
      if (node instanceof Document) {
        if (node.documentElement) out.push(node.documentElement);
        return out;
      }
      if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
        out.push(...Array.from(node.children));
        return out;
      }
      if (node instanceof Element) {
        out.push(...Array.from(node.children)); // light DOM
        const open = (node as Element).shadowRoot;
        if (open) out.push(...Array.from(open.children));
        const closed = hostToRoot.get(node as Element);
        if (closed) out.push(...Array.from(closed.children));
        return out;
      }
      return out;
    };

    const composedDescendants = (node: Node): Element[] => {
      const out: Element[] = [];
      const q: Element[] = [...composedChildren(node)];
      while (q.length) {
        const el = q.shift()!;
        out.push(el);
        q.push(...composedChildren(el));
      }
      return out;
    };

    // Simple composed-tree resolver with axis '/', '//' and trailing [n]
    const resolveSimpleXPath = (xp: string): Element | null => {
      const s = String(xp || "").trim();
      if (!s) return null;
      const path = s.replace(/^xpath=/i, "");

      type Axis = "child" | "desc";
      type Step = {
        axis: Axis;
        raw: string;
        tag: string;
        index: number | null;
      };

      const steps: Step[] = [];
      {
        let i = 0;
        while (i < path.length) {
          let axis: Axis = "child";
          if (path.startsWith("//", i)) {
            axis = "desc";
            i += 2;
          } else if (path[i] === "/") {
            axis = "child";
            i += 1;
          }

          const start = i;
          while (i < path.length && path[i] !== "/") i++;
          const raw = path.slice(start, i).trim();
          if (!raw) continue;

          const m = raw.match(/^(.*?)(\[(\d+)\])?$/u);
          const base = (m?.[1] ?? raw).trim();
          const index = m?.[3] ? Math.max(1, Number(m[3])) : null;
          const tag = base === "" ? "*" : base.toLowerCase();
          steps.push({ axis, raw, tag, index });
        }
      }

      if (state.debug) {
        console.info("[v3-piercer][resolve] start", {
          url: location.href,
          steps: steps.map((s) => ({
            axis: s.axis,
            raw: s.raw,
            tag: s.tag,
            index: s.index,
          })),
        });
      }

      let current: Node[] = [document];

      for (const step of steps) {
        const wantIdx = step.index;
        let chosen: Element | null = null;

        for (const root of current) {
          const pool =
            step.axis === "child"
              ? composedChildren(root)
              : composedDescendants(root);
          const matches: Element[] = [];
          for (const el of pool) {
            if (step.tag === "*" || el.localName === step.tag) matches.push(el);
          }

          if (state.debug) {
            console.info("[v3-piercer][resolve] step", {
              axis: step.axis,
              tag: step.tag,
              index: wantIdx,
              poolCount: pool.length,
              matchesCount: matches.length,
            });
          }

          if (!matches.length) continue;

          if (wantIdx != null) {
            const idx0 = wantIdx - 1;
            chosen = idx0 >= 0 && idx0 < matches.length ? matches[idx0] : null;
          } else {
            chosen = matches[0];
          }

          if (chosen) break;
        }

        if (!chosen) {
          if (state.debug) {
            console.info("[v3-piercer][resolve] no-match", { step: step.raw });
          }
          return null;
        }
        current = [chosen];
      }

      const result = current.length ? (current[0] as Element) : null;
      if (state.debug) {
        console.info("[v3-piercer][resolve] done", {
          found: !!result,
          tag: result?.localName ?? "",
        });
      }
      return result;
    };

    window.__stagehandV3__ = {
      getClosedRoot: (host: Element) => hostToRoot.get(host),
      stats: () => ({
        installed: true,
        url: location.href,
        isTop: window.top === window,
        open: state.openCount,
        closed: state.closedCount,
      }),
      resolveSimpleXPath,
    } satisfies StagehandV3Backdoor;
  };

  // Look at the *current* function on the prototype. If it's already our patched
  // function, reuse its shared state and rebind the backdoor (no new WeakMap).
  const currentFn = Element.prototype.attachShadow as PatchedFn;
  if (currentFn.__v3Patched && currentFn.__v3State) {
    currentFn.__v3State.debug = DEBUG; // keep debug toggle consistent
    bindBackdoor(currentFn.__v3State);
    // idempotent: do not log "installed" again
    return;
  }

  // First-time install: create shared state and replace the prototype method
  const state: V3InternalState = {
    hostToRoot: new WeakMap<Element, ShadowRoot>(),
    openCount: 0,
    closedCount: 0,
    debug: DEBUG,
  };

  const original = currentFn; // keep a reference to call through
  const patched: PatchedFn = function (
    this: Element,
    init: ShadowRootInit,
  ): ShadowRoot {
    const mode = init?.mode ?? "open";
    const root = original.call(this, init);
    try {
      state.hostToRoot.set(this, root);
      if (mode === "closed") state.closedCount++;
      else state.openCount++;
      if (state.debug) {
        console.info("[v3-piercer] attachShadow", {
          tag: (this as Element).tagName?.toLowerCase() ?? "",
          mode,
          url: location.href,
        });
      }
    } catch {
      //
    }
    return root;
  } as PatchedFn;

  // Mark the *patched* function with metadata so re-entry sees it
  patched.__v3Patched = true;
  patched.__v3State = state;

  Object.defineProperty(Element.prototype, "attachShadow", {
    configurable: true,
    writable: true,
    value: patched,
  });

  // Optionally tag existing open roots (closed cannot be discovered post-hoc)
  if (opts.tagExisting) {
    try {
      const walker = document.createTreeWalker(
        document,
        NodeFilter.SHOW_ELEMENT,
      );
      while (walker.nextNode()) {
        const el = walker.currentNode as Element;
        if (el.shadowRoot) {
          state.hostToRoot.set(el, el.shadowRoot);
          state.openCount++;
        }
      }
    } catch {
      //
    }
  }

  window.__stagehandV3Injected = true;
  bindBackdoor(state);

  if (state.debug) {
    console.info("[v3-piercer] installed", {
      url: location.href,
      isTop: window.top === window,
      readyState: document.readyState,
    });
  }
}
