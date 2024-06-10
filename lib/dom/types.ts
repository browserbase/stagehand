export {};
declare global {
  interface Window {
    chunkNumber: number;
    processDom: ({
      chunksSeen,
      chunk,
    }: {
      chunksSeen?: Array<number>;
      chunk?: number;
    }) => Promise<{
      outputString: string;
      selectorMap: Record<number, string>;
      chunk: number;
      chunks: number[];
    }>;

    processFullDom: () => Promise<{
      outputString: string;
      selectorMap: Record<number, string>;
    }>;

    debugDom: () => Promise<void>;
    cleanupDebug: () => void;
  }
}
