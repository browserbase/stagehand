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
  /** Simple composed-tree resolver (no predicates; does not cross iframes) */
  resolveSimpleXPath(xp: string): Element | null;
}

// Symbol keys for stealth - invisible to Object.keys() AND Object.getOwnPropertyNames()
// Use Symbol.for() to create global registry symbols accessible across contexts
export const V3_INJECTED_KEY = Symbol.for("__stagehandV3Injected__");
export const V3_BACKDOOR_KEY = Symbol.for("__stagehandV3__");

declare global {
  interface Window {
    // Symbol-keyed properties for stealth (not enumerable by any standard method)
    [V3_INJECTED_KEY]?: boolean;
    [V3_BACKDOOR_KEY]?: StagehandV3Backdoor;
    // Legacy string-keyed fallbacks (deprecated - will be removed)
    __stagehandV3Injected?: boolean;
    __stagehandV3__?: StagehandV3Backdoor;
  }
}
