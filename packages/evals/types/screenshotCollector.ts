export interface ScreenshotCollectorOptions {
  /**
   * Interval in ms for polling-based screenshot capture.
   * If provided, start() will begin polling at this interval.
   * If omitted, use addScreenshot() via the V3 event bus for event-driven collection.
   */
  interval?: number;
  maxScreenshots?: number;
}

// Minimal page-like interface: supports screenshot() and optional event hooks
export type ScreenshotCapablePage = {
  screenshot: (...args: []) => Promise<Buffer | string>;
  on?: (event: string, listener: (...args: []) => void) => void;
  off?: (event: string, listener: (...args: []) => void) => void;
};
