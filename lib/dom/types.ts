export {};
declare global {
  interface Window {
    chunkNumber: number;
    processDom: (chunksSeen: Array<number>) => Promise<{
      outputString: string;
      selectorMap: Record<number, string>;
      chunk: number;
      chunks: number[];
    }>;
    processElements: (chunk: number) => Promise<{
      outputString: string;
      selectorMap: Record<number, string>;
    }>;
    debugDom: () => Promise<void>;
    cleanupDebug: () => void;
    scrollToHeight: (height: number) => Promise<void>;
  }
}
