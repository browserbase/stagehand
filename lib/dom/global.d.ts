export {};
declare global {
  interface Window {
    chunkNumber: number;
    showChunks?: boolean;
    processDom: (chunksSeen: Array<number>) => Promise<{
      outputString: string;
      selectorMap: Record<number, (string | string[])[]>;
      chunk: number;
      chunks: number[];
    }>;
    processAllOfDom: () => Promise<{
      outputString: string;
      selectorMap: Record<number, (string | string[])[]>;
    }>;
    processElements: (chunk: number) => Promise<{
      outputString: string;
      selectorMap: Record<number, (string | string[])[]>;
    }>;
    debugDom: (chunkNumber?: number) => Promise<void>;
    cleanupDebug: () => void;
    drawChunk: (
      selectorMap: Record<number, (string | string[])[]>,
      forceDraw?: boolean,
    ) => void;
    findElementWithIframeSupport: (xpath: string | string[]) => Element;
    scrollToHeight: (height: number) => Promise<void>;
    waitForDomSettle: () => Promise<void>;
    __playwright?: unknown;
    __pw_manual?: unknown;
    __PW_inspect?: unknown;
    storeDOM: () => string;
    restoreDOM: (storedDOM: string) => void;
    createTextBoundingBoxes: () => void;
    getElementBoundingBoxes: (xpath: string | string[]) => Array<{
      text: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }>;
  }
}
