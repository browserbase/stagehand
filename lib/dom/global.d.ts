export interface StagehandBackdoor {
  /** Closed shadow-root accessors */
  getClosedRoot(host: Element): ShadowRoot | undefined;
  queryClosed(host: Element, selector: string): Element[];
  xpathClosed(host: Element, xpath: string): Node[];
}
declare global {
  interface Window {
    __stagehandInjected?: boolean;
    __playwright?: unknown;
    __pw_manual?: unknown;
    __PW_inspect?: unknown;
    getScrollableElementXpaths: (topN?: number) => Promise<string[]>;
    getNodeFromXpath: (xpath: string) => Node | null;
    waitForElementScrollEnd: (element: HTMLElement) => Promise<void>;
    readonly __stagehand__?: StagehandBackdoor;
  }
}
