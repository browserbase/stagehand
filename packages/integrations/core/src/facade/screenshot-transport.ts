import type { StagehandFacadeScreenshot } from "./tools.js";

export type ScreenshotOptions = {
  fullPage?: boolean;
  type?: "png" | "jpeg";
  quality?: number;
};

type CaptureScreenshot = (options: ScreenshotOptions) => Promise<StagehandFacadeScreenshot>;

export type TransportSafeScreenshot = {
  image: StagehandFacadeScreenshot;
  options: ScreenshotOptions;
  adjusted: boolean;
};

const SCREENSHOT_BUDGET_FLAG = "--max-screenshot-base64-bytes=";

export function screenshotBase64BudgetFromArgs(args: string[]): number | undefined {
  const value = args.find((arg) => arg.startsWith(SCREENSHOT_BUDGET_FLAG));
  if (value === undefined) return undefined;

  const budget = Number(value.slice(SCREENSHOT_BUDGET_FLAG.length));
  if (!Number.isSafeInteger(budget) || budget < 1_024) {
    throw new Error(`${SCREENSHOT_BUDGET_FLAG} must be an integer of at least 1024.`);
  }
  return budget;
}

export async function captureScreenshotWithinBase64Budget(
  capture: CaptureScreenshot,
  requested: ScreenshotOptions,
  maxBase64Bytes: number,
): Promise<TransportSafeScreenshot> {
  const attempts = screenshotAttempts(requested);
  for (const [index, options] of attempts.entries()) {
    const image = await capture(options);
    if (Buffer.byteLength(image.data, "utf8") <= maxBase64Bytes) {
      return { image, options, adjusted: index > 0 || !sameOptions(options, requested) };
    }
  }

  throw new Error(
    `Screenshot exceeds the ${maxBase64Bytes}-byte MCP transport budget after compressed viewport retries.`,
  );
}

function screenshotAttempts(requested: ScreenshotOptions): ScreenshotOptions[] {
  const initial: ScreenshotOptions = {
    fullPage: requested.fullPage ?? false,
    type: requested.type ?? "jpeg",
    ...(requested.type === "png" ? {} : { quality: requested.quality ?? 40 }),
  };
  const maxFallbackQuality = requested.type === "png" ? 40 : (requested.quality ?? 40);
  const attempts = [
    initial,
    {
      fullPage: false,
      type: "jpeg" as const,
      quality: Math.min(maxFallbackQuality, 40),
    },
    {
      fullPage: false,
      type: "jpeg" as const,
      quality: Math.min(maxFallbackQuality, 25),
    },
    {
      fullPage: false,
      type: "jpeg" as const,
      quality: Math.min(maxFallbackQuality, 10),
    },
  ];
  return attempts.filter(
    (candidate, index) => attempts.findIndex((other) => sameOptions(candidate, other)) === index,
  );
}

function sameOptions(left: ScreenshotOptions, right: ScreenshotOptions): boolean {
  return (
    left.fullPage === right.fullPage && left.type === right.type && left.quality === right.quality
  );
}
