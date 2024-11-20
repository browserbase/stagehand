import { type Frame, type ElementHandle, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { exec } from "child_process";

type AnnotationBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  id: string;
};

type NumberPosition = {
  x: number;
  y: number;
};

export class ScreenshotService {
  private page: Page;
  private selectorMap: Record<number, string[]>;
  private annotationBoxes: AnnotationBox[] = [];
  private numberPositions: NumberPosition[] = [];
  private isDebugEnabled: boolean;
  private verbose: 0 | 1 | 2;

  constructor(
    page: Page,
    selectorMap: Record<number, string[]>,
    verbose: 0 | 1 | 2,
    isDebugEnabled: boolean = false,
  ) {
    this.page = page;
    this.selectorMap = selectorMap;
    this.isDebugEnabled = isDebugEnabled;
    this.verbose = verbose;
  }

  log({
    category,
    message,
    level = 1,
  }: {
    category?: string;
    message: string;
    level?: 0 | 1 | 2;
  }) {
    if (this.verbose >= level) {
      const categoryString = category ? `:${category}` : "";
      console.log(`[stagehand${categoryString}] ${message}`);
    }
  }

  async getScreenshot(
    fullpage: boolean = true,
    quality?: number,
  ): Promise<Buffer> {
    if (quality && (quality < 0 || quality > 100)) {
      throw new Error("quality must be between 0 and 100");
    }

    return await this.page.screenshot({
      fullPage: fullpage,
      quality,
      type: "jpeg",
    });
  }

  async getScreenshotPixelCount(screenshot: Buffer): Promise<number> {
    const image = sharp(screenshot);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      this.log({
        category: "Error",
        message: "Unable to determine image dimensions.",
        level: 0,
      });
      throw new Error("Unable to determine image dimensions.");
    }

    const pixelCount = metadata.width * metadata.height;
    this.log({
      category: "Info",
      message: `Screenshot pixel count: ${pixelCount}`,
      level: 1,
    });
    return pixelCount;
  }

  async getAnnotatedScreenshot(fullpage: boolean): Promise<Buffer> {
    this.annotationBoxes = [];
    this.numberPositions = [];

    const screenshot = await this.getScreenshot(fullpage);
    const image = sharp(screenshot);

    const { width, height } = await image.metadata();
    // this.log({
    //   category: "Debug",
    //   message: `Annotating screenshot ${JSON.stringify(this.selectorMap)}`,
    //   level: 2,
    // });

    const svgAnnotations = await Promise.all(
      Object.entries(this.selectorMap).map(async ([id, selectors]) =>
        this.createElementAnnotation(id, selectors),
      ),
    );

    const scrollPosition = await this.page.evaluate(() => {
      return {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    });

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:${-scrollPosition.scrollX}px;top:${-scrollPosition.scrollY}px;">
        ${svgAnnotations.join("")}
      </svg>
    `;

    const annotatedScreenshot = await image
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .toBuffer();

    if (this.isDebugEnabled) {
      await ScreenshotService.saveAndOpenScreenshot(annotatedScreenshot);
    }

    return annotatedScreenshot;
  }

  private async createElementAnnotation(
    id: string,
    selectors: string[],
  ): Promise<string> {
    try {
      let element = null;

      // Try each selector until one works
      const selectorPromises: Promise<any | null>[] = selectors.map(
        async (selector) => {
          try {
            element = await this.page.locator(`xpath=${selector}`).first();
            const box = await element.boundingBox({ timeout: 5_000 });
            return box;
          } catch (e) {
            return null;
          }
        },
      );

      const boxes = await Promise.all(selectorPromises);
      const box = boxes.find((b) => b !== null);

      if (!box) {
        throw new Error(`Unable to create annotation for element ${id}`);
      }

      const scrollPosition = await this.page.evaluate(() => ({
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }));

      const adjustedBox = {
        x: box.x + scrollPosition.scrollX,
        y: box.y + scrollPosition.scrollY,
        width: box.width,
        height: box.height,
        id: id,
      };

      this.annotationBoxes.push(adjustedBox);

      const numberPosition = this.findNonOverlappingNumberPosition(adjustedBox);

      const circleRadius = 12;

      return `
        <rect x="${adjustedBox.x}" y="${adjustedBox.y}" width="${adjustedBox.width}" height="${adjustedBox.height}" 
              fill="none" stroke="red" stroke-width="2" />
        <circle cx="${numberPosition.x}" cy="${numberPosition.y}" r="${circleRadius}" fill="white" stroke="red" stroke-width="2" />
        <text x="${numberPosition.x}" y="${numberPosition.y}" fill="red" font-size="16" font-weight="bold" 
              text-anchor="middle" dominant-baseline="central">
          ${id}
        </text>
      `;
    } catch (error) {
      this.log({
        category: "Vision",
        message: `Warning: Failed to create annotation for element ${id}: ${error}, trace: ${error.stack}`,
        level: 0,
      });
      return "";
    }
  }

  private findNonOverlappingNumberPosition(box: AnnotationBox): NumberPosition {
    const circleRadius = 12;
    let position: NumberPosition = {
      x: box.x - circleRadius,
      y: box.y - circleRadius,
    };

    let attempts = 0;
    const maxAttempts = 10;
    const offset = 5;

    while (this.isNumberOverlapping(position) && attempts < maxAttempts) {
      position.y += offset;
      attempts++;
    }

    this.numberPositions.push(position);
    return position;
  }

  private isNumberOverlapping(position: NumberPosition): boolean {
    const circleRadius = 12;
    return this.numberPositions.some(
      (existingPosition) =>
        Math.sqrt(
          Math.pow(position.x - existingPosition.x, 2) +
            Math.pow(position.y - existingPosition.y, 2),
        ) <
        circleRadius * 2,
    );
  }

  static async saveAndOpenScreenshot(screenshot: Buffer): Promise<void> {
    const screenshotDir = path.join(process.cwd(), "screenshots");
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(screenshotDir, `screenshot-${timestamp}.png`);

    fs.writeFileSync(filename, screenshot);
    console.log(`Screenshot saved to: ${filename}`);

    // Open the screenshot with the default image viewer
    if (process.platform === "win32") {
      exec(`start ${filename}`);
    } else if (process.platform === "darwin") {
      exec(`open ${filename}`);
    } else {
      exec(`xdg-open ${filename}`);
    }
  }
}
