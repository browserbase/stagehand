export {};
declare global {
  interface Window {
    __stagehandInjected?: boolean;
    __playwright?: unknown;
    __pw_manual?: unknown;
    __PW_inspect?: unknown;
    getScrollableElementXpaths: (topN?: number) => Promise<string[]>;
    getNodeFromXpath: (xpath: string) => Node | null;
    waitForElementScrollEnd: (element: HTMLElement) => Promise<void>;
  }
}
