import { Page } from "@playwright/test";

// Dynamic import for sharp to handle optional dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharp: any = null;

async function getSharp() {
  if (!sharp) {
    try {
      const sharpModule = await import("sharp");
      // Sharp is a CommonJS module, so it exports the function directly
      sharp = sharpModule.default || sharpModule;
    } catch {
      // Sharp not available, will return fallback values
    }
  }
  return sharp;
}

export interface ScreenshotCollectorOptions {
  interval?: number;
  maxScreenshots?: number;
  captureOnNavigation?: boolean;
  interceptScreenshots?: boolean;
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
  private lastScreenshot?: Buffer;
  private ssimThreshold: number = 0.92;
  private mseThreshold: number = 50;
  private originalScreenshot?: typeof this.page.screenshot;
  private interceptScreenshots: boolean;

  constructor(page: Page, options: ScreenshotCollectorOptions = {}) {
    this.page = page;
    this.interval = options.interval || 5000;
    this.maxScreenshots = options.maxScreenshots || 10;
    this.captureOnNavigation = options.captureOnNavigation ?? true;
    this.interceptScreenshots = options.interceptScreenshots ?? false;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    // Setup screenshot interception if enabled
    if (this.interceptScreenshots) {
      this.setupScreenshotInterception();
    } else {
      // Original time-based approach
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
    }

    this.captureScreenshot("initial");
  }

  stop(): Buffer[] {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Restore original screenshot method if we intercepted it
    if (this.originalScreenshot && this.interceptScreenshots) {
      this.page.screenshot = this.originalScreenshot;
      this.originalScreenshot = undefined;
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

      // Check if we should keep this screenshot based on image diff
      let shouldKeep = true;
      if (this.lastScreenshot && trigger !== "initial" && trigger !== "final") {
        try {
          // First do a quick MSE check
          const mse = await this.calculateMSE(this.lastScreenshot, screenshot);
          if (mse < this.mseThreshold) {
            // Very similar, skip
            shouldKeep = false;
          } else {
            // Significant difference detected, verify with SSIM
            const ssim = await this.calculateSSIM(
              this.lastScreenshot,
              screenshot,
            );
            shouldKeep = ssim < this.ssimThreshold;
          }
        } catch (error) {
          // If comparison fails, keep the screenshot
          console.error("Image comparison failed:", error);
          shouldKeep = true;
        }
      }

      if (shouldKeep) {
        this.screenshots.push(screenshot);
        this.lastScreenshot = screenshot;

        if (this.screenshots.length > this.maxScreenshots) {
          this.screenshots.shift();
        }

        console.log(
          `Screenshot captured (trigger: ${trigger}), total: ${this.screenshots.length}`,
        );
      } else {
        console.log(
          `Screenshot skipped (trigger: ${trigger}), too similar to previous`,
        );
      }
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
    this.lastScreenshot = undefined;
  }

  private setupScreenshotInterception(): void {
    console.log("🔧 Setting up screenshot interception...");
    // Store the original screenshot method
    this.originalScreenshot = this.page.screenshot.bind(this.page);
    let lastCallTime = 0;
    let screenshotCount = 0;

    // Override the screenshot method
    this.page.screenshot = async (
      options?: Parameters<typeof this.originalScreenshot>[0],
    ) => {
      screenshotCount++;
      const screenshot = await this.originalScreenshot!(options);

      // If called within 3 seconds of previous call, likely from agent
      const now = Date.now();
      const timeSinceLastCall = now - lastCallTime;

      if (timeSinceLastCall < 3000 && lastCallTime > 0) {
        console.log(
          `📸 Agent screenshot detected (#${screenshotCount}, ${timeSinceLastCall}ms since last)`,
        );
        this.onAgentScreenshot(screenshot);
      } else {
        console.log(
          `📷 Non-agent screenshot ignored (#${screenshotCount}, ${timeSinceLastCall}ms since last)`,
        );
      }

      lastCallTime = now;
      return screenshot;
    };
  }

  private async onAgentScreenshot(screenshot: Buffer): Promise<void> {
    // Apply MSE/SSIM logic to decide if we should keep this screenshot
    let shouldKeep = true;
    if (this.lastScreenshot) {
      try {
        // First do a quick MSE check
        const mse = await this.calculateMSE(this.lastScreenshot, screenshot);
        if (mse < this.mseThreshold) {
          // Very similar, skip
          shouldKeep = false;
        } else {
          // Significant difference detected, verify with SSIM
          const ssim = await this.calculateSSIM(
            this.lastScreenshot,
            screenshot,
          );
          shouldKeep = ssim < this.ssimThreshold;
        }
      } catch (error) {
        // If comparison fails, keep the screenshot
        console.error("Image comparison failed:", error);
        shouldKeep = true;
      }
    }

    if (shouldKeep) {
      this.screenshots.push(screenshot);
      this.lastScreenshot = screenshot;

      if (this.screenshots.length > this.maxScreenshots) {
        this.screenshots.shift();
      }

      console.log(
        `Agent screenshot captured, total: ${this.screenshots.length}`,
      );
    } else {
      console.log(`Agent screenshot skipped, too similar to previous`);
    }
  }

  private async calculateMSE(img1: Buffer, img2: Buffer): Promise<number> {
    try {
      const sharpInstance = await getSharp();
      if (!sharpInstance) {
        return Number.MAX_SAFE_INTEGER;
      }

      // Resize images for faster comparison
      const size = { width: 400, height: 300 };
      const data1 = await sharpInstance(img1).resize(size).raw().toBuffer();
      const data2 = await sharpInstance(img2).resize(size).raw().toBuffer();

      if (data1.length !== data2.length) return Number.MAX_SAFE_INTEGER;

      let sum = 0;
      for (let i = 0; i < data1.length; i++) {
        const diff = data1[i] - data2[i];
        sum += diff * diff;
      }

      return sum / data1.length;
    } catch {
      // If sharp is not available, assume images are different
      return Number.MAX_SAFE_INTEGER;
    }
  }

  private async calculateSSIM(img1: Buffer, img2: Buffer): Promise<number> {
    try {
      const sharpInstance = await getSharp();
      if (!sharpInstance) {
        return 0;
      }

      // Resize and convert to grayscale for SSIM calculation
      const size = { width: 400, height: 300 };
      const gray1 = await sharpInstance(img1)
        .resize(size)
        .grayscale()
        .raw()
        .toBuffer();
      const gray2 = await sharpInstance(img2)
        .resize(size)
        .grayscale()
        .raw()
        .toBuffer();

      if (gray1.length !== gray2.length) return 0;

      // Simplified SSIM calculation
      const c1 = 0.01 * 0.01;
      const c2 = 0.03 * 0.03;

      let sum1 = 0,
        sum2 = 0,
        sum1_sq = 0,
        sum2_sq = 0,
        sum12 = 0;
      const N = gray1.length;

      for (let i = 0; i < N; i++) {
        sum1 += gray1[i];
        sum2 += gray2[i];
        sum1_sq += gray1[i] * gray1[i];
        sum2_sq += gray2[i] * gray2[i];
        sum12 += gray1[i] * gray2[i];
      }

      const mean1 = sum1 / N;
      const mean2 = sum2 / N;
      const var1 = sum1_sq / N - mean1 * mean1;
      const var2 = sum2_sq / N - mean2 * mean2;
      const cov12 = sum12 / N - mean1 * mean2;

      const numerator = (2 * mean1 * mean2 + c1) * (2 * cov12 + c2);
      const denominator =
        (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2);

      return numerator / denominator;
    } catch {
      // If sharp is not available, assume images are different
      return 0;
    }
  }
}
