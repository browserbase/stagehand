import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  savedChars: number;
  compressionRatio: number;
  screenshotCount: number;
  ariaTreeCount: number;
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

function isAriaTreePart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { toolName?: unknown }).toolName === "ariaTree"
  );
}

export function processMessages(params: LanguageModelV2CallOptions): {
  processedPrompt: LanguageModelV2CallOptions["prompt"];
  stats: CompressionStats;
} {
  // Calculate original content size
  const originalContentSize = JSON.stringify(params.prompt).length;
  const screenshotIndices = findToolIndices(params.prompt, "screenshot");
  const ariaTreeIndices = findToolIndices(params.prompt, "ariaTree");

  // Process messages and compress old screenshots
  const processedPrompt = params.prompt.map(
    (message: unknown, index: number) => {
      if (isToolMessage(message)) {
        if (
          (message.content as unknown[]).some((part) => isScreenshotPart(part))
        ) {
          const shouldCompress = shouldCompressScreenshot(
            index,
            screenshotIndices,
          );
          if (shouldCompress) {
            return compressScreenshotMessage(message);
          }
        }
        if (
          (message.content as unknown[]).some((part) => isAriaTreePart(part))
        ) {
          const shouldCompress = shouldCompressAriaTree(index, ariaTreeIndices);
          if (shouldCompress) {
            return compressAriaTreeMessage(message);
          }
        }
      }

      return message;
    },
  );

  const compressedContentSize = JSON.stringify(processedPrompt).length;
  const stats = calculateCompressionStats(
    originalContentSize,
    compressedContentSize,
    screenshotIndices.length,
    ariaTreeIndices.length,
  );

  return {
    processedPrompt: processedPrompt as LanguageModelV2CallOptions["prompt"],
    stats,
  };
}

function findToolIndices(
  prompt: unknown[],
  toolName: "screenshot" | "ariaTree",
): number[] {
  const screenshotIndices: number[] = [];

  prompt.forEach((message, index) => {
    if (isToolMessage(message)) {
      const hasMatch = (message.content as unknown[]).some((part) =>
        toolName === "screenshot"
          ? isScreenshotPart(part)
          : isAriaTreePart(part),
      );
      if (hasMatch) {
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

function shouldCompressAriaTree(
  index: number,
  ariaTreeIndices: number[],
): boolean {
  const isNewestAriaTree = index === Math.max(...ariaTreeIndices);
  // Only keep the most recent ARIA tree
  return !isNewestAriaTree;
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

function compressAriaTreeMessage(message: {
  role: "tool";
  content: unknown[];
}): { role: "tool"; content: unknown[] } {
  const updatedContent = (message.content as unknown[]).map((part) => {
    if (isAriaTreePart(part)) {
      return {
        ...(part as object),
        result: [
          {
            type: "text",
            text: "ARIA tree extracted for context of page elements",
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
  ariaTreeCount: number,
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
    ariaTreeCount,
  };
}
