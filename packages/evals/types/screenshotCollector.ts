export interface ScreenshotCollectorOptions {
  interval?: number;
  maxScreenshots?: number;
}

export type ScreenshotCapablePage = {
  screenshot: (...args: []) => Promise<Buffer | string>;
  on?: (event: string, listener: (...args: []) => void) => void;
  off?: (event: string, listener: (...args: []) => void) => void;
};
