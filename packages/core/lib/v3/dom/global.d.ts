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
  /** Composed-tree XPath resolver (does not cross iframes) */
  resolveSimpleXPath(xp: string): Element | null;
}

declare global {
  interface Window {
    __stagehandV3Injected?: boolean;
    __stagehandV3__?: StagehandV3Backdoor;
  }
}
