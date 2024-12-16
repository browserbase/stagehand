export {};
declare global {
  interface Window {
    chunkNumber: number;
    showChunks?: boolean;
    processDom: (chunksSeen: Array<number>) => Promise<{
      outputString: string;
      selectorMap: Record<number, string[]>;
      chunk: number;
      chunks: number[];
    }>;
    processAllOfDom: () => Promise<{
      outputString: string;
      selectorMap: Record<number, string[]>;
    }>;
    processElements: (chunk: number) => Promise<{
      outputString: string;
      selectorMap: Record<number, string[]>;
    }>;
    debugDom: () => Promise<void>;
    cleanupDebug: () => void;
    scrollToHeight: (height: number) => Promise<void>;
    waitForDomSettle: () => Promise<void>;
    __playwright?: unknown;
    __pw_manual?: unknown;
    __PW_inspect?: unknown;
    storeDOM: () => string;
    restoreDOM: (storedDOM: string) => void;
    createTextBoundingBoxes: () => void;
    getElementBoundingBoxes: (xpath: string) => Array<{
      text: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }>;
  }
}
