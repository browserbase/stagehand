import { Page } from "@playwright/test";

export interface ScreenshotCollectorOptions {
  interval?: number;
  maxScreenshots?: number;
  captureOnNavigation?: boolean;
}

export class ScreenshotCollector {
  private screenshots: Buffer[] = [];
  private page: Page;
  private interval: number;
  private maxScreenshots: number;
  private captureOnNavigation: boolean;
  private intervalId?: NodeJS.Timeout;
  private navigationListeners: Array<() => void> = [];
  private isCapturing: boolean = false;

  constructor(page: Page, options: ScreenshotCollectorOptions = {}) {
    this.page = page;
    this.interval = options.interval || 5000;
    this.maxScreenshots = options.maxScreenshots || 10;
    this.captureOnNavigation = options.captureOnNavigation ?? true;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(async () => {
      await this.captureScreenshot("interval");
    }, this.interval);

    if (this.captureOnNavigation) {
      const loadListener = () => this.captureScreenshot("load");
      const domContentListener = () =>
        this.captureScreenshot("domcontentloaded");

      this.page.on("load", loadListener);
      this.page.on("domcontentloaded", domContentListener);

      this.navigationListeners = [
        () => this.page.off("load", loadListener),
        () => this.page.off("domcontentloaded", domContentListener),
      ];
    }

    this.captureScreenshot("initial");
  }

  stop(): Buffer[] {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.navigationListeners.forEach((removeListener) => removeListener());
    this.navigationListeners = [];

    this.captureScreenshot("final");

    return this.getScreenshots();
  }

  private async captureScreenshot(trigger: string): Promise<void> {
    if (this.isCapturing) {
      return;
    }

    this.isCapturing = true;

    try {
      const screenshot = await this.page.screenshot();
      this.screenshots.push(screenshot);

      if (this.screenshots.length > this.maxScreenshots) {
        this.screenshots.shift();
      }

      console.log(
        `Screenshot captured (trigger: ${trigger}), total: ${this.screenshots.length}`,
      );
    } catch (error) {
      console.error(`Failed to capture screenshot (${trigger}):`, error);
    } finally {
      this.isCapturing = false;
    }
  }

  getScreenshots(): Buffer[] {
    return [...this.screenshots];
  }

  getScreenshotCount(): number {
    return this.screenshots.length;
  }

  clear(): void {
    this.screenshots = [];
  }
}
