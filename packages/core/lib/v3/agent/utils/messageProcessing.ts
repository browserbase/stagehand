import type { ModelMessage } from "ai";

// Vision action tools that include screenshots in their results
const VISION_ACTION_TOOLS = [
  "click",
  "type",
  "dragAndDrop",
  "wait",
  "fillFormVision",
  "scroll",
];

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

function isVisionActionPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const toolName = (part as { toolName?: unknown }).toolName;
  return typeof toolName === "string" && VISION_ACTION_TOOLS.includes(toolName);
}

function isVisionPart(part: unknown): boolean {
  return isScreenshotPart(part) || isVisionActionPart(part);
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
 * - Keep only the 2 most recent vision results (screenshots OR vision action tools like click/type/etc)
 * - Keep only the 1 most recent ariaTree (replace older ones with placeholder)
 *
 * @param messages - The messages array to modify in-place
 * @returns Number of items compressed
 */
export function processMessages(messages: ModelMessage[]): number {
  let compressedCount = 0;

  // Find indices of all vision-related tool results (screenshots + vision actions)
  // and ariaTree results
  const visionIndices: number[] = [];
  const ariaTreeIndices: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (isToolMessage(message)) {
      const content = message.content as unknown[];
      if (content.some(isVisionPart)) {
        visionIndices.push(i);
      }
      if (content.some(isAriaTreePart)) {
        ariaTreeIndices.push(i);
      }
    }
  }

  // Compress old vision results (keep 2 most recent across all vision tools)
  if (visionIndices.length > 2) {
    const toCompress = visionIndices.slice(0, visionIndices.length - 2);
    for (const index of toCompress) {
      const message = messages[index];
      if (isToolMessage(message)) {
        // Both functions are safe to call - they only modify their respective part types
        compressScreenshotMessage(message);
        compressVisionActionMessage(message);
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
 * Tool result part structure from AI SDK.
 * The output field uses a discriminated union - type determines value format:
 * - type: "content" -> value: Array<{type: "text", ...} | {type: "media", ...}>
 * - type: "text" -> value: string
 * - type: "json" -> value: JSONValue
 * - type: "error-text" -> value: string
 * - type: "error-json" -> value: JSONValue
 */
interface ToolResultPart {
  output?: {
    type: string;
    value?: unknown;
  };
}

/**
 * Check if output has type "content" (array-based value format).
 * Only outputs with type "content" should have array values.
 */
function isContentTypeOutput(output: {
  type: string;
  value?: unknown;
}): boolean {
  return output.type === "content";
}

/**
 * Compress screenshot message content in-place.
 * Only modifies outputs with type "content" to maintain schema validity.
 * Replaces entire output object to ensure type/value consistency.
 */
function compressScreenshotMessage(message: {
  role: "tool";
  content: unknown[];
}): void {
  for (const part of message.content) {
    if (isScreenshotPart(part)) {
      const typedPart = part as ToolResultPart;
      // Only compress if output exists and has type "content"
      if (typedPart.output && isContentTypeOutput(typedPart.output)) {
        // Replace entire output to ensure type/value consistency
        typedPart.output = {
          type: "content",
          value: [{ type: "text", text: "screenshot taken" }],
        };
      }
    }
  }
}

/**
 * Compress vision action message content in-place by removing the screenshot
 * but keeping the action result text.
 * Only modifies outputs with type "content" to maintain schema validity.
 */
function compressVisionActionMessage(message: {
  role: "tool";
  content: unknown[];
}): void {
  for (const part of message.content) {
    if (isVisionActionPart(part)) {
      const typedPart = part as ToolResultPart;

      // Only compress if output is type "content" (array-based value)
      if (
        typedPart.output &&
        isContentTypeOutput(typedPart.output) &&
        Array.isArray(typedPart.output.value)
      ) {
        // Filter out media content but keep text results
        const filteredValue = (
          typedPart.output.value as Array<{ type?: string }>
        ).filter(
          (item) => item && typeof item === "object" && item.type !== "media",
        );
        // Replace entire output to ensure type/value consistency
        typedPart.output = {
          type: "content",
          value: filteredValue,
        };
      }
    }
  }
}

/**
 * Compress ariaTree message content in-place.
 * Only modifies outputs with type "content" to maintain schema validity.
 * Replaces entire output object to ensure type/value consistency.
 */
function compressAriaTreeMessage(message: {
  role: "tool";
  content: unknown[];
}): void {
  for (const part of message.content) {
    if (isAriaTreePart(part)) {
      const typedPart = part as ToolResultPart;
      // Only compress if output exists and has type "content"
      if (typedPart.output && isContentTypeOutput(typedPart.output)) {
        typedPart.output = {
          type: "content",
          value: [
            {
              type: "text",
              text: "ARIA tree extracted for context of page elements",
            },
          ],
        };
      }
    }
  }
}
