/**
 * Independent screenshot capture for Browserbase sessions.
 * Captures screenshots based on multiple triggers:
 * - Time-based: Every X milliseconds
 * - Step-based: After N agent turns
 * - Event-based: Navigation, scroll, DOM changes
 */

import { chromium, Browser, CDPSession, Page } from "playwright";
import sharp from "sharp";

export interface ScreenshotCaptureOptions {
  /** Maximum screenshots to keep in buffer */
  maxScreenshots?: number;
  /** Time interval in ms for periodic captures (0 = disabled) */
  intervalMs?: number;
  /** Capture on every N steps (0 = disabled) */
  stepInterval?: number;
  /** Capture on page navigation */
  captureOnNavigation?: boolean;
  /** Capture on significant scroll (pixels threshold) */
  scrollThreshold?: number;
  /** Capture on DOM mutations (element count change threshold) */
  domMutationThreshold?: number;
  /** SSIM threshold for deduplication (0-1, lower = more strict) */
  ssimThreshold?: number;
  /** MSE threshold for quick comparison */
  mseThreshold?: number;
}

const DEFAULT_OPTIONS: Required<ScreenshotCaptureOptions> = {
  maxScreenshots: 8,
  intervalMs: 3000, // Every 3 seconds
  stepInterval: 0, // Disabled by default
  captureOnNavigation: true,
  scrollThreshold: 500, // 500px scroll triggers capture
  domMutationThreshold: 0, // Disabled by default (can be noisy)
  ssimThreshold: 0.75,
  mseThreshold: 30,
};

interface CaptureMetadata {
  trigger: "interval" | "step" | "navigation" | "scroll" | "dom" | "manual" | "initial" | "final";
  timestamp: number;
  url?: string;
  scrollY?: number;
}

export class BrowserbaseScreenshotCapture {
  private options: Required<ScreenshotCaptureOptions>;
  private screenshots: Array<{ buffer: Buffer; metadata: CaptureMetadata }> = [];
  private lastScreenshot?: Buffer;
  private browser?: Browser;
  private page?: Page;
  private cdpSession?: CDPSession;
  private intervalId?: NodeJS.Timeout;
  private isCapturing = false;
  private isStopped = false;
  private stepCount = 0;
  private lastScrollY = 0;
  private lastUrl = "";
  private connectUrl: string;

  constructor(connectUrl: string, options: ScreenshotCaptureOptions = {}) {
    this.connectUrl = connectUrl;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start capturing screenshots.
   * Connects to the browser and sets up capture triggers.
   */
  async start(): Promise<void> {
    if (this.browser) {
      console.warn("[ScreenshotCapture] Already started");
      return;
    }

    console.log("[ScreenshotCapture] Connecting to browser...");

    try {
      // Connect to the Browserbase session via CDP
      this.browser = await chromium.connectOverCDP(this.connectUrl, {
        timeout: 30000,
      });

      // Get the default context and page
      const contexts = this.browser.contexts();
      if (contexts.length === 0) {
        throw new Error("No browser contexts found");
      }

      const pages = contexts[0].pages();
      this.page = pages.length > 0 ? pages[0] : await contexts[0].newPage();

      // Set up CDP session for advanced events
      this.cdpSession = await this.page.context().newCDPSession(this.page);

      // Enable necessary CDP domains
      await this.cdpSession.send("Page.enable");
      await this.cdpSession.send("Runtime.enable");

      // Set up event listeners
      await this.setupEventListeners();

      // Start interval-based capture if enabled
      if (this.options.intervalMs > 0) {
        this.startIntervalCapture();
      }

      // Capture initial screenshot
      await this.captureScreenshot("initial");

      console.log("[ScreenshotCapture] Started successfully");
    } catch (error) {
      console.error("[ScreenshotCapture] Failed to start:", error);
      throw error;
    }
  }

  /**
   * Stop capturing and return all screenshots.
   */
  async stop(): Promise<Buffer[]> {
    this.isStopped = true;

    // Stop interval capture
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Capture final screenshot
    try {
      await this.captureScreenshot("final");
    } catch {
      // Ignore errors on final capture
    }

    // Disconnect from browser (don't close it - Browserbase manages lifecycle)
    if (this.browser) {
      try {
        this.browser.close();
      } catch {
        // Ignore close errors
      }
      this.browser = undefined;
    }

    console.log(`[ScreenshotCapture] Stopped. Captured ${this.screenshots.length} screenshots`);

    return this.screenshots.map((s) => s.buffer);
  }

  /**
   * Notify of an agent step (for step-based capture).
   */
  async onStep(): Promise<void> {
    this.stepCount++;

    if (this.options.stepInterval > 0 && this.stepCount % this.options.stepInterval === 0) {
      await this.captureScreenshot("step");
    }
  }

  /**
   * Manually trigger a screenshot capture.
   */
  async capture(): Promise<void> {
    await this.captureScreenshot("manual");
  }

  /**
   * Get current screenshot count.
   */
  getScreenshotCount(): number {
    return this.screenshots.length;
  }

  /**
   * Get all screenshots with metadata.
   */
  getScreenshotsWithMetadata(): Array<{ buffer: Buffer; metadata: CaptureMetadata }> {
    return [...this.screenshots];
  }

  private async setupEventListeners(): Promise<void> {
    if (!this.cdpSession || !this.page) return;

    // Navigation events
    if (this.options.captureOnNavigation) {
      this.cdpSession.on("Page.frameNavigated", async (event: { frame: { parentId?: string; url: string } }) => {
        // Only capture for main frame
        if (!event.frame.parentId) {
          const url = event.frame.url;
          if (url !== this.lastUrl) {
            this.lastUrl = url;
            // Small delay to let page render
            setTimeout(() => this.captureScreenshot("navigation"), 500);
          }
        }
      });

      this.cdpSession.on("Page.loadEventFired", async () => {
        // Capture after page fully loads
        setTimeout(() => this.captureScreenshot("navigation"), 200);
      });
    }

    // Scroll detection via polling (more reliable than events)
    if (this.options.scrollThreshold > 0) {
      this.startScrollDetection();
    }
  }

  private startIntervalCapture(): void {
    this.intervalId = setInterval(async () => {
      if (!this.isStopped) {
        await this.captureScreenshot("interval");
      }
    }, this.options.intervalMs);
  }

  private startScrollDetection(): void {
    const checkScroll = async () => {
      if (this.isStopped || !this.page) return;

      try {
        const scrollY = await this.page.evaluate(() => window.scrollY);
        const scrollDelta = Math.abs(scrollY - this.lastScrollY);

        if (scrollDelta >= this.options.scrollThreshold) {
          this.lastScrollY = scrollY;
          await this.captureScreenshot("scroll");
        }
      } catch {
        // Page might be navigating, ignore
      }

      // Check again in 500ms
      if (!this.isStopped) {
        setTimeout(checkScroll, 500);
      }
    };

    // Start checking
    setTimeout(checkScroll, 1000);
  }

  private async captureScreenshot(trigger: CaptureMetadata["trigger"]): Promise<boolean> {
    if (this.isStopped && trigger !== "final") return false;
    if (this.isCapturing) return false;
    if (!this.page) return false;

    this.isCapturing = true;

    try {
      // Take screenshot
      const buffer = await this.page.screenshot({
        type: "png",
        fullPage: false,
      });

      // Get current URL and scroll position
      let url = "";
      let scrollY = 0;
      try {
        url = this.page.url();
        scrollY = await this.page.evaluate(() => window.scrollY);
      } catch {
        // Ignore evaluation errors
      }

      // Check if we should keep this screenshot (deduplication)
      const shouldKeep = await this.shouldKeepScreenshot(buffer, trigger);

      if (shouldKeep) {
        const metadata: CaptureMetadata = {
          trigger,
          timestamp: Date.now(),
          url,
          scrollY,
        };

        this.screenshots.push({ buffer, metadata });
        this.lastScreenshot = buffer;

        // Maintain max buffer size
        while (this.screenshots.length > this.options.maxScreenshots) {
          this.screenshots.shift();
        }

        console.log(
          `[ScreenshotCapture] Captured (${trigger}): ${this.screenshots.length}/${this.options.maxScreenshots}`
        );
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[ScreenshotCapture] Capture failed (${trigger}):`, error);
      return false;
    } finally {
      this.isCapturing = false;
    }
  }

  private async shouldKeepScreenshot(
    buffer: Buffer,
    trigger: CaptureMetadata["trigger"]
  ): Promise<boolean> {
    // Always keep initial and final
    if (trigger === "initial" || trigger === "final") {
      return true;
    }

    // Always keep if no previous screenshot
    if (!this.lastScreenshot) {
      return true;
    }

    try {
      // Quick MSE check first
      const mse = await this.calculateMSE(this.lastScreenshot, buffer);
      if (mse < this.options.mseThreshold) {
        return false; // Too similar
      }

      // SSIM check for more accuracy
      const ssim = await this.calculateSSIM(this.lastScreenshot, buffer);
      return ssim < this.options.ssimThreshold;
    } catch {
      // If comparison fails, keep the screenshot
      return true;
    }
  }

  private async calculateMSE(img1: Buffer, img2: Buffer): Promise<number> {
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
  }

  private async calculateSSIM(img1: Buffer, img2: Buffer): Promise<number> {
    const size = { width: 400, height: 300 };
    const gray1 = await sharp(img1).resize(size).grayscale().raw().toBuffer();
    const gray2 = await sharp(img2).resize(size).grayscale().raw().toBuffer();

    if (gray1.length !== gray2.length) return 0;

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
    const denominator = (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2);

    return numerator / denominator;
  }
}

/**
 * Factory function to create and start a screenshot capture session.
 */
export async function createScreenshotCapture(
  connectUrl: string,
  options?: ScreenshotCaptureOptions
): Promise<BrowserbaseScreenshotCapture> {
  const capture = new BrowserbaseScreenshotCapture(connectUrl, options);
  await capture.start();
  return capture;
}
