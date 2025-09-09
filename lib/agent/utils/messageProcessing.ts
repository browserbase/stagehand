import { type LanguageModelV1CallOptions } from "ai";

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

function isImagePart(
  part: unknown,
): part is { type: "image"; data: string; mimeType: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "image"
  );
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isAccessibilityTreeText(
  part: unknown,
): part is { type: "text"; text: string } {
  return (
    isTextPart(part) &&
    (part as { text: string }).text.startsWith("Accessibility Tree:")
  );
}

export function processMessages(params: LanguageModelV1CallOptions): {
  processedPrompt: LanguageModelV1CallOptions["prompt"];
  stats: CompressionStats;
} {
  // Calculate original content size
  const originalContentSize = JSON.stringify(params.prompt).length;
  const screenshotIndices = findToolIndices(params.prompt, "screenshot");
  const ariaTreeIndices = findToolIndices(params.prompt, "ariaTree");

  // Process messages and compress old screenshots
  const processedPrompt = params.prompt.map((message, index) => {
    if (isToolMessage(message)) {
      // Tool-name based compression for screenshot/ariaTree
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
      if ((message.content as unknown[]).some((part) => isAriaTreePart(part))) {
        const shouldCompress = shouldCompressAriaTree(index, ariaTreeIndices);
        if (shouldCompress) {
          return compressAriaTreeMessage(message);
        }
      }

      // Additionally, compress raw parts emitted via experimental_toToolResultContent
      const updatedContent = (message.content as unknown[]).map((part) => {
        if (isImagePart(part)) {
          // Replace older images with small text marker. Since this path doesn't know "older",
          // we always compress to be safe at this pre-pass.
          return { type: "text", text: "[screenshot]" };
        }
        if (isAccessibilityTreeText(part)) {
          const text = (part as { type: "text"; text: string }).text;
          if (text.length > 4000) {
            return {
              type: "text",
              text: text.substring(0, 3500) + "... [truncated]",
            };
          }
        }
        return part;
      });

      return { ...message, content: updatedContent } as typeof message;
    }

    return { ...message };
  });

  const compressedContentSize = JSON.stringify(processedPrompt).length;
  const stats = calculateCompressionStats(
    originalContentSize,
    compressedContentSize,
    screenshotIndices.length,
    ariaTreeIndices.length,
  );

  return {
    processedPrompt:
      processedPrompt as unknown as LanguageModelV1CallOptions["prompt"],
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
