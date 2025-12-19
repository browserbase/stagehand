import { V3 } from "@browserbasehq/stagehand";
import sharp from "sharp";
import { ScreenshotCollectorOptions } from "../types/screenshotCollector";

export class ScreenshotCollector {
  private screenshots: Buffer[] = [];
  private v3: V3;
  private interval?: number;
  private maxScreenshots: number;
  private intervalId?: NodeJS.Timeout;
  private isCapturing: boolean = false;
  private lastScreenshot?: Buffer;
  private ssimThreshold: number = 0.75;
  private mseThreshold: number = 30;
  private stopped: boolean = false;

  constructor(v3: V3, options: ScreenshotCollectorOptions = {}) {
    this.v3 = v3;
    this.interval = options.interval; // undefined means event-driven mode
    this.maxScreenshots = options.maxScreenshots || 10;
  }

  /**
   * Start interval-based screenshot capture.
   * Only activates if interval option was provided in constructor.
   * For event-driven collection, use addScreenshot() directly via the V3 event bus.
   */
  start(): void {
    // Only start interval if interval was provided
    if (!this.interval) {
      return;
    }

    if (this.intervalId) {
      return;
    }

    // Set up time-based screenshot capture
    this.intervalId = setInterval(() => {
      this.captureScreenshot("interval").catch((error) => {
        console.error("Interval screenshot failed:", error);
      });
    }, this.interval);

    // Capture initial screenshot without blocking
    this.captureScreenshot("initial").catch((error) => {
      console.error("Failed to capture initial screenshot:", error);
    });
  }

  async stop(): Promise<Buffer[]> {
    // Mark as stopped first to prevent any new operations
    this.stopped = true;

    // Clear interval if running
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Reset capturing flag to unblock any pending state
    this.isCapturing = false;

    // Try to capture final screenshot, but don't fail if CDP is disconnected
    try {
      await this.captureScreenshot("final");
    } catch {
      // Ignore errors - CDP may be disconnected
    }

    // Return a copy and clear internal state to free memory
    const result = [...this.screenshots];
    this.screenshots = [];
    this.lastScreenshot = undefined;

    return result;
  }

  private async captureScreenshot(trigger: string): Promise<void> {
    // Don't capture if stopped (unless it's the final capture) or already capturing
    if ((this.stopped && trigger !== "final") || this.isCapturing) {
      return;
    }
    this.isCapturing = true;

    try {
      const page = await this.v3.context.awaitActivePage();
      const screenshot = await page.screenshot({ fullPage: false });

      // If stopped while awaiting screenshot (and not final), don't process further
      if (this.stopped && trigger !== "final") {
        return;
      }

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
  }

  /**
   * Manually add a screenshot to the collection.
   * Use this with the V3 event bus for event-driven screenshot collection.
   * @param screenshot The screenshot buffer to add
   */
  async addScreenshot(screenshot: Buffer): Promise<void> {
    // Don't add if stopped or already capturing
    if (this.stopped || this.isCapturing) {
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
