export interface ScreenshotCollectorOptions {
  interval?: number;
  maxScreenshots?: number;
  captureOnNavigation?: boolean;
}

// Minimal page-like interface: supports screenshot() and optional event hooks
export type ScreenshotCapablePage = {
  screenshot: (...args: []) => Promise<Buffer | string>;
  on?: (event: string, listener: (...args: []) => void) => void;
  off?: (event: string, listener: (...args: []) => void) => void;
};
