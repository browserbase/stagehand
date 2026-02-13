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

    window.__stagehandV3__ = {
      getClosedRoot: (host: Element) => hostToRoot.get(host),
      stats: () => ({
        installed: true,
        url: location.href,
        isTop: window.top === window,
        open: state.openCount,
        closed: state.closedCount,
      }),
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
