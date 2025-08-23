import { type LanguageModelV1CallOptions } from "ai";

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  savedChars: number;
  compressionRatio: number;
  screenshotCount: number;
}

function isToolMessage(
  message: unknown,
): message is { role: "tool"; content: unknown[] } {
  return (
    !!message &&
    typeof message === "object" &&
    (message as { role?: unknown }).role === "tool" &&
    Array.isArray((message as { content?: unknown }).content)
  );
}

function isScreenshotPart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { toolName?: unknown }).toolName === "screenshot"
  );
}

export function processMessages(params: LanguageModelV1CallOptions): {
  processedPrompt: LanguageModelV1CallOptions["prompt"];
  stats: CompressionStats;
} {
  // Calculate original content size
  const originalContentSize = JSON.stringify(params.prompt).length;

  // Find all screenshot tool messages
  const screenshotIndices = findScreenshotIndices(params.prompt);

  //console.log(`🔍 Found ${screenshotIndices.length} screenshot messages`);

  // Process messages and compress old screenshots
  const processedPrompt = params.prompt.map((message, index) => {
    if (isToolMessage(message)) {
      const hasScreenshot = (message.content as unknown[]).some((part) =>
        isScreenshotPart(part),
      );

      if (hasScreenshot) {
        const shouldCompress = shouldCompressScreenshot(
          index,
          screenshotIndices,
        );

        if (shouldCompress) {
          return compressScreenshotMessage(message);
        }
      }
    }

    // console.log(message);
    return { ...message };
  });

  // Calculate compression stats
  const compressedContentSize = JSON.stringify(processedPrompt).length;
  const stats = calculateCompressionStats(
    originalContentSize,
    compressedContentSize,
    screenshotIndices.length,
  );

  return {
    processedPrompt:
      processedPrompt as unknown as LanguageModelV1CallOptions["prompt"],
    stats,
  };
}

function findScreenshotIndices(prompt: unknown[]): number[] {
  const screenshotIndices: number[] = [];

  prompt.forEach((message, index) => {
    if (isToolMessage(message)) {
      const hasScreenshot = (message.content as unknown[]).some((part) =>
        isScreenshotPart(part),
      );
      if (hasScreenshot) {
        screenshotIndices.push(index);
      }
    }
  });

  return screenshotIndices;
}

function shouldCompressScreenshot(
  index: number,
  screenshotIndices: number[],
): boolean {
  const isNewestScreenshot = index === Math.max(...screenshotIndices);
  const isSecondNewestScreenshot =
    screenshotIndices.length > 1 &&
    index === screenshotIndices.sort((a, b) => b - a)[1];

  return !isNewestScreenshot && !isSecondNewestScreenshot;
}

function compressScreenshotMessage(message: {
  role: "tool";
  content: unknown[];
}): { role: "tool"; content: unknown[] } {
  const updatedContent = (message.content as unknown[]).map((part) => {
    if (isScreenshotPart(part)) {
      return {
        ...(part as object),
        result: [
          {
            type: "text",
            text: "screenshot taken",
          },
        ],
      } as unknown;
    }
    return part;
  });

  return {
    ...message,
    content: updatedContent,
  } as { role: "tool"; content: unknown[] };
}

function calculateCompressionStats(
  originalSize: number,
  compressedSize: number,
  screenshotCount: number,
): CompressionStats {
  const savedChars = originalSize - compressedSize;
  const compressionRatio =
    originalSize > 0
      ? ((originalSize - compressedSize) / originalSize) * 100
      : 0;

  return {
    originalSize,
    compressedSize,
    savedChars,
    compressionRatio,
    screenshotCount,
  };
}
