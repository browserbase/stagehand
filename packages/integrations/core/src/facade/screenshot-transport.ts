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

  const raw = value.slice(SCREENSHOT_BUDGET_FLAG.length);
  const budget = Number(raw);
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(budget) || budget < 1_024) {
    throw new Error(`${SCREENSHOT_BUDGET_FLAG} must be an integer of at least 1024.`);
  }
  return budget;
}

/**
 * Model APIs reject images with a side longer than this. Anthropic allows
 * 8000 px for a lone image but only 2000 px once a request carries many
 * images, which every multi-step agent conversation does. Full-page captures
 * of long pages exceed both and killed whole runs with a 400, so oversized
 * captures fall back to the viewport like over-budget ones do.
 */
export const MAX_SCREENSHOT_SIDE_PX = 2000;

export async function captureScreenshotWithinBase64Budget(
  capture: CaptureScreenshot,
  requested: ScreenshotOptions,
  maxBase64Bytes: number,
  maxSidePx = MAX_SCREENSHOT_SIDE_PX,
): Promise<TransportSafeScreenshot> {
  const attempts = screenshotAttempts(requested);
  for (const [index, options] of attempts.entries()) {
    const image = await capture(options);
    if (Buffer.byteLength(image.data, "utf8") > maxBase64Bytes) continue;
    const size = imageDimensions(image);
    const tooLarge = size !== undefined && Math.max(size.width, size.height) > maxSidePx;
    if (!tooLarge) {
      return { image, options, adjusted: index > 0 || !sameOptions(options, requested) };
    }
  }

  throw new Error(
    `Screenshot exceeds the ${maxBase64Bytes}-byte MCP transport budget or the ${maxSidePx}px side limit after compressed viewport retries.`,
  );
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function imageDimensions(
  image: StagehandFacadeScreenshot,
): { width: number; height: number } | undefined {
  const bytes = Buffer.from(image.data, "base64");
  if (image.mimeType === "image/png") {
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    ) {
      return undefined;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      continue;
    }
    if (offset + 2 > bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return undefined;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return undefined;
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
