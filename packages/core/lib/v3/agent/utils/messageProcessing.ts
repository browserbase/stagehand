import type { ModelMessage } from "ai";

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

/**
 * Compress old screenshot/ariaTree data in messages in-place.
 *
 * Strategy:
 * - Keep only the 2 most recent screenshots (replace older ones with placeholder)
 * - Keep only the 1 most recent ariaTree (replace older ones with placeholder)
 *
 * @param messages - The messages array to modify in-place
 * @returns Number of items compressed
 */
export function processMessages(messages: ModelMessage[]): number {
  let compressedCount = 0;

  // Find indices of screenshot and ariaTree tool results
  const screenshotIndices: number[] = [];
  const ariaTreeIndices: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (isToolMessage(message)) {
      const content = message.content as unknown[];
      if (content.some(isScreenshotPart)) {
        screenshotIndices.push(i);
      }
      if (content.some(isAriaTreePart)) {
        ariaTreeIndices.push(i);
      }
    }
  }

  // Compress old screenshots (keep 2 most recent)
  if (screenshotIndices.length > 2) {
    const toCompress = screenshotIndices.slice(0, screenshotIndices.length - 2);
    for (const idx of toCompress) {
      const message = messages[idx];
      if (isToolMessage(message)) {
        compressScreenshotMessage(message);
        compressedCount++;
      }
    }
  }

  // Compress old ariaTree results (keep 1 most recent)
  if (ariaTreeIndices.length > 1) {
    const toCompress = ariaTreeIndices.slice(0, ariaTreeIndices.length - 1);
    for (const idx of toCompress) {
      const message = messages[idx];
      if (isToolMessage(message)) {
        compressAriaTreeMessage(message);
        compressedCount++;
      }
    }
  }

  return compressedCount;
}

/**
 * Tool result part structure from AI SDK - has both output.value AND result
 */
interface ToolResultPart {
  output?: {
    type: string;
    value?: unknown[];
  };
  result?: unknown[];
}

/**
 * Compress screenshot message content in-place
 */
function compressScreenshotMessage(message: {
  role: "tool";
  content: unknown[];
}): void {
  for (const part of message.content) {
    if (isScreenshotPart(part)) {
      const typedPart = part as ToolResultPart;
      const placeholder = [{ type: "text", text: "screenshot taken" }];

      if (typedPart.output?.value) {
        typedPart.output.value = placeholder;
      }
      // Also set result for consistency
      if (typedPart.result) {
        typedPart.result = placeholder;
      }
    }
  }
}

/**
 * Compress ariaTree message content in-place
 */
function compressAriaTreeMessage(message: {
  role: "tool";
  content: unknown[];
}): void {
  for (const part of message.content) {
    if (isAriaTreePart(part)) {
      const typedPart = part as ToolResultPart;
      const placeholder = [
        {
          type: "text",
          text: "ARIA tree extracted for context of page elements",
        },
      ];
      // Compress output.value
      if (typedPart.output?.value) {
        typedPart.output.value = placeholder;
      }
      // Also set result for consistency
      if (typedPart.result) {
        typedPart.result = placeholder;
      }
    }
  }
}
