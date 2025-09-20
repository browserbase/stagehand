import { Page } from "@playwright/test";
import { EvalLogger } from "../logger";
import { LogLine } from "@browserbasehq/stagehand";
import sharp from "sharp";

export interface ScreenshotCollectorOptions {
  interval?: number;
  maxScreenshots?: number;
  interceptScreenshots?: boolean;
  logger?: EvalLogger;
}

export class ScreenshotCollector {
  private screenshots: Buffer[] = [];
  private page: Page;
  private interval: number;
  private maxScreenshots: number;
  private intervalId?: NodeJS.Timeout;
  private isCapturing: boolean = false;
  private lastScreenshot?: Buffer;
  private ssimThreshold: number = 0.92;
  private mseThreshold: number = 50;
  private originalScreenshot?: typeof this.page.screenshot;
  private interceptScreenshots: boolean;
  private logger?: EvalLogger;
  private isRunning: boolean = false;

  constructor(page: Page, options: ScreenshotCollectorOptions = {}) {
    this.page = page;
    this.interval = options.interval || 10000;
    this.maxScreenshots = options.maxScreenshots || 10;
    this.interceptScreenshots = options.interceptScreenshots ?? true;
    this.logger = options.logger;
    this.ssimThreshold = process.env.SCREENSHOT_SSIM_THRESHOLD
      ? parseFloat(process.env.SCREENSHOT_SSIM_THRESHOLD)
      : 0.85;
    this.mseThreshold = process.env.SCREENSHOT_MSE_THRESHOLD
      ? parseFloat(process.env.SCREENSHOT_MSE_THRESHOLD)
      : 200;
  }

  start(): void {
    if (this.isRunning) {
      this.log({
        category: "screenshot_collector",
        message: "Screenshot collector already running, ignoring start()",
        level: 1,
      });
      return;
    }

    this.isRunning = true;

    // Setup screenshot interception if enabled (for agent screenshots)
    if (this.interceptScreenshots) {
      this.setupScreenshotInterception();
    }

    // Always start the interval timer
    this.startIntervalTimer();

    this.captureScreenshot("initial");
  }

  stop(): Buffer[] {
    if (!this.isRunning) {
      this.log({
        category: "screenshot_collector",
        message: "Screenshot collector not running, ignoring stop()",
        level: 1,
      });
      return this.getScreenshots();
    }

    this.isRunning = false;

    // Clear interval timer first to prevent any more interval captures
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Restore original screenshot method if we intercepted it
    if (this.originalScreenshot && this.interceptScreenshots) {
      this.page.screenshot = this.originalScreenshot;
      this.originalScreenshot = undefined;
    }

    // Capture final screenshot only if we're not already capturing
    if (!this.isCapturing) {
      this.captureScreenshot("final");
    }

    this.log({
      category: "screenshot_collector",
      message: `Screenshot collector stopped with ${this.screenshots.length} screenshots`,
      level: 1,
    });

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

          // Always log MSE comparison
          this.log({
            category: "screenshot_collector",
            message: `MSE comparison: ${mse.toFixed(2)} vs threshold ${this.mseThreshold} (${mse < this.mseThreshold ? "similar" : "different"})`,
            level: 2,
          });

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
            this.log({
              category: "screenshot_collector",
              message: `SSIM ${ssim.toFixed(4)} ${shouldKeep ? "<" : ">="} threshold ${this.ssimThreshold}, ${shouldKeep ? "keeping" : "skipping"} screenshot`,
              level: 2,
            });
          }
        } catch (error) {
          // If comparison fails, keep the screenshot
          this.logError("Image comparison failed:", error);
          shouldKeep = true;
        }
      }

      if (shouldKeep) {
        this.screenshots.push(screenshot);
        this.lastScreenshot = screenshot;

        if (this.screenshots.length > this.maxScreenshots) {
          this.screenshots.shift();
        }

        this.log({
          category: "screenshot_collector",
          message: `Screenshot captured (trigger: ${trigger}), total: ${this.screenshots.length}`,
          level: 2,
        });
      } else {
        this.log({
          category: "screenshot_collector",
          message: `Screenshot skipped (trigger: ${trigger}), too similar to previous`,
          level: 2,
        });
      }
    } catch (error) {
      this.logError(`Failed to capture screenshot (${trigger}):`, error);
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

  private startIntervalTimer(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    // Only start timer if we're still running
    if (this.isRunning) {
      this.intervalId = setInterval(async () => {
        // Check if still running before capturing
        if (this.isRunning) {
          await this.captureScreenshot("interval");
        }
      }, this.interval);
    }
  }

  private setupScreenshotInterception(): void {
    this.log({
      category: "screenshot_collector",
      message:
        "🔧 Setting up hybrid screenshot collection with interception...",
      level: 1,
    });
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
        this.log({
          category: "screenshot_collector",
          message: `📸 Agent screenshot detected (#${screenshotCount}, ${timeSinceLastCall}ms since last)`,
          level: 2,
        });
        // Process agent screenshot and reset the interval timer
        await this.onAgentScreenshot(screenshot);
        // Reset the interval timer since we just captured a screenshot
        this.startIntervalTimer();
      } else {
        this.log({
          category: "screenshot_collector",
          message: `📷 Non-agent screenshot ignored (#${screenshotCount}, ${timeSinceLastCall}ms since last)`,
          level: 2,
        });
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

        // Always log MSE comparison
        this.log({
          category: "screenshot_collector",
          message: `MSE comparison: ${mse.toFixed(2)} vs threshold ${this.mseThreshold} (${mse < this.mseThreshold ? "similar" : "different"})`,
          level: 2,
        });

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
          this.log({
            category: "screenshot_collector",
            message: `SSIM ${ssim.toFixed(4)} ${shouldKeep ? "<" : ">="} threshold ${this.ssimThreshold}, ${shouldKeep ? "keeping" : "skipping"} screenshot`,
            level: 2,
          });
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

      this.log({
        category: "screenshot_collector",
        message: `Agent screenshot captured (hybrid mode), total: ${this.screenshots.length}`,
        level: 2,
      });
    } else {
      this.log({
        category: "screenshot_collector",
        message: `Agent screenshot skipped (hybrid mode), too similar to previous`,
        level: 2,
      });
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
    } catch (error) {
      // Log error and assume images are different
      this.logError("MSE calculation failed:", error);
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

      // Debug: Check data properties
      const samplePixels = [
        gray1[0],
        gray1[1],
        gray1[2],
        gray2[0],
        gray2[1],
        gray2[2],
      ];
      this.log({
        category: "screenshot_collector",
        message: `SSIM input debug: buffer lengths=${gray1.length}/${gray2.length}, sample pixels=[${samplePixels.join(",")}]`,
        level: 2,
      });

      // Simplified SSIM calculation
      // Use proper constants for 8-bit images (0-255 range)
      const L = 255; // Dynamic range for 8-bit images
      const k1 = 0.01;
      const k2 = 0.03;
      const c1 = k1 * L * (k1 * L);
      const c2 = k2 * L * (k2 * L);

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

      const ssim = denominator !== 0 ? numerator / denominator : 0;

      // Always log SSIM calculation details for debugging
      this.log({
        category: "screenshot_collector",
        message: `SSIM calculation: result=${ssim.toFixed(4)}, mean1=${mean1.toFixed(2)}, mean2=${mean2.toFixed(2)}, var1=${var1.toFixed(2)}, var2=${var2.toFixed(2)}, cov12=${cov12.toFixed(2)}`,
        level: 2,
      });

      this.log({
        category: "screenshot_collector",
        message: `SSIM components: c1=${c1.toFixed(2)}, c2=${c2.toFixed(2)}, numerator=${numerator.toFixed(2)}, denominator=${denominator.toFixed(2)}`,
        level: 2,
      });

      return ssim;
    } catch (error) {
      // Log error and assume images are different
      this.logError("SSIM calculation failed:", error);
      return 0;
    }
  }

  private log(logLine: LogLine): void {
    if (this.logger) {
      this.logger.log(logLine);
    } else {
      console.log(`[${logLine.category}] ${logLine.message}`);
    }
  }

  private logError(message: string, error: unknown): void {
    const logLine: LogLine = {
      category: "screenshot_collector",
      message: `${message}: ${error}`,
      level: 0,
    };
    if (this.logger) {
      this.logger.error(logLine);
    } else {
      console.error(`[${logLine.category}] ${logLine.message}`);
    }
  }
}
