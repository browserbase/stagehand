export {};

export interface PageElementMap {
  [key: string]: {
    string: string;
    chunk: number;
    embedding: number[];
  };
}

declare global {
  interface Window {
    chunkNumber: number;
    processDom: (chunksSeen: Array<number>, chunkPriorities?: Array<number>) => Promise<{
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
    getPageElementMap: () => Promise<PageElementMap>;
    getPageChunkMap: () => Promise<PageElementMap>;
  }
}
