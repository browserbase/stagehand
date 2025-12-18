export interface ScreenshotCollectorOptions {
  /**
   * Interval in ms for polling-based screenshot capture.
   * If provided, start() will begin polling at this interval.
   * If omitted, use addScreenshot() via the V3 event bus for event-driven collection.
   */
  interval?: number;
  maxScreenshots?: number;
}
