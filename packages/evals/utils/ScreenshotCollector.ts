import { ScreenshotCapablePage } from "../types/screenshotCollector";
import { ScreenshotCollectorOptions } from "../types/screenshotCollector";
import sharp from "sharp";

export class ScreenshotCollector {
  private screenshots: Buffer[] = [];
  private page: ScreenshotCapablePage;
  private interval: number;
  private maxScreenshots: number;
  private captureOnNavigation: boolean;
  private intervalId?: NodeJS.Timeout;
  private navigationListeners: Array<() => void> = [];
  private isCapturing: boolean = false;
  private lastScreenshot?: Buffer;
  private ssimThreshold: number = 0.75;
  private mseThreshold: number = 30;

  constructor(
    page: ScreenshotCapablePage,
    options: ScreenshotCollectorOptions = {},
  ) {
    this.page = page;
    this.interval = options.interval || 5000;
    this.maxScreenshots = options.maxScreenshots || 10;
    this.captureOnNavigation = options.captureOnNavigation ?? false;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    // Set up time-based screenshot capture
    this.intervalId = setInterval(() => {
      this.captureScreenshot("interval").catch(() => {});
    }, this.interval);

    if (this.captureOnNavigation && this.page.on && this.page.off) {
      const loadListener = async () => {
        await this.captureScreenshot("load").catch(() => {});
      };
      const domContentListener = async () => {
        await this.captureScreenshot("domcontentloaded").catch(() => {});
      };

      // Wrap in try-catch since some page implementations (like V3 Page)
      // may not support these events and throw an error
      try {
        this.page.on("load", loadListener);
        this.navigationListeners.push(() =>
          this.page.off!("load", loadListener),
        );
      } catch {
        // Event not supported, skip
      }

      try {
        this.page.on("domcontentloaded", domContentListener);
        this.navigationListeners.push(() =>
          this.page.off!("domcontentloaded", domContentListener),
        );
      } catch {
        // Event not supported, skip
      }
    }

    // Capture initial screenshot without blocking
    this.captureScreenshot("initial").catch(() => {});
  }

  stop(): Buffer[] {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.navigationListeners.forEach((removeListener) => removeListener());
    this.navigationListeners = [];

    // Capture final screenshot without blocking
    this.captureScreenshot("final").catch(() => {});

    console.log(
      `[ScreenshotCollector] Finished - total screenshots: ${this.screenshots.length}`,
    );
    return this.getScreenshots();
  }

  private async captureScreenshot(trigger: string): Promise<void> {
    if (this.isCapturing) {
      return;
    }
    this.isCapturing = true;

    try {
      const rawScreenshot = await this.page.screenshot();
      const screenshot =
        typeof rawScreenshot === "string"
          ? Buffer.from(rawScreenshot, "base64")
          : (rawScreenshot as Buffer);

      // Check if we should keep this screenshot based on image diff
      let shouldKeep = true;
      if (this.lastScreenshot && trigger !== "initial" && trigger !== "final") {
        try {
          // First do a quick MSE check
          const mse = await this.calculateMSE(this.lastScreenshot, screenshot);
          if (mse < this.mseThreshold) {
            shouldKeep = false;
          } else {
            // Significant difference detected, verify with SSIM
            const ssim = await this.calculateSSIM(
              this.lastScreenshot,
              screenshot,
            );
            shouldKeep = ssim < this.ssimThreshold;
          }
        } catch {
          // If comparison fails, keep the screenshot
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
          `[ScreenshotCollector] Screenshot captured (${trigger}) - total: ${this.screenshots.length}`,
        );
      }
    } catch {
      // Failed to capture, skip silently
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

  /**
   * Manually add a screenshot to the collection
   * @param screenshot The screenshot buffer to add
   */
  async addScreenshot(screenshot: Buffer): Promise<void> {
    if (this.isCapturing) {
      return;
    }
    this.isCapturing = true;

    try {
      // Apply MSE/SSIM logic to decide if we should keep this screenshot
      let shouldKeep = true;
      if (this.lastScreenshot) {
        try {
          // First do a quick MSE check
          const mse = await this.calculateMSE(this.lastScreenshot, screenshot);
          if (mse < this.mseThreshold) {
            shouldKeep = false;
          } else {
            // Significant difference detected, verify with SSIM
            const ssim = await this.calculateSSIM(
              this.lastScreenshot,
              screenshot,
            );
            shouldKeep = ssim < this.ssimThreshold;
          }
        } catch {
          // If comparison fails, keep the screenshot
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
          `[ScreenshotCollector] Screenshot added - total: ${this.screenshots.length}`,
        );
      }
    } finally {
      this.isCapturing = false;
    }
  }

  private async calculateMSE(img1: Buffer, img2: Buffer): Promise<number> {
    try {
      // Resize images for faster comparison
      const size = { width: 400, height: 300 };
      const data1 = await sharp(img1).resize(size).raw().toBuffer();
      const data2 = await sharp(img2).resize(size).raw().toBuffer();

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
      // Resize and convert to grayscale for SSIM calculation
      const size = { width: 400, height: 300 };
      const gray1 = await sharp(img1).resize(size).grayscale().raw().toBuffer();
      const gray2 = await sharp(img2).resize(size).grayscale().raw().toBuffer();

      if (gray1.length !== gray2.length) return 0;

      // Simplified SSIM calculation
      const c1 = 0.01 * 0.01;
      const c2 = 0.03 * 0.03;

      let sum1 = 0,
        sum2 = 0,
        sum1Sq = 0,
        sum2Sq = 0,
        sum12 = 0;
      const N = gray1.length;

      for (let i = 0; i < N; i++) {
        sum1 += gray1[i];
        sum2 += gray2[i];
        sum1Sq += gray1[i] * gray1[i];
        sum2Sq += gray2[i] * gray2[i];
        sum12 += gray1[i] * gray2[i];
      }

      const mean1 = sum1 / N;
      const mean2 = sum2 / N;
      const var1 = sum1Sq / N - mean1 * mean1;
      const var2 = sum2Sq / N - mean2 * mean2;
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
