import type { AgentStepFinishedEvent } from "./agentEvidenceEvents.js";
import type { AgentEvidence } from "./types.js";

export const REDACTED_INLINE_IMAGE = "[redacted inline image payload]";

const INLINE_IMAGE_KEYS = new Set(["screenshotBase64"]);

function shouldRedactBase64Key(key: string, actionName?: string): boolean {
  return INLINE_IMAGE_KEYS.has(key) || (actionName === "screenshot" && key === "base64");
}

/** MCP-style image block: `{ data, mimeType: "image/..." }`. */
function isDataImageBlock(value: object): value is { data: string; mimeType: string } {
  const block = value as { data?: unknown; mimeType?: unknown };
  return (
    typeof block.data === "string" &&
    typeof block.mimeType === "string" &&
    block.mimeType.startsWith("image/")
  );
}

interface InlineImagePayload {
  base64: string;
  mediaType: string;
}

function collectInlineImages(
  value: unknown,
  actionName: string | undefined,
  out: InlineImagePayload[],
): InlineImagePayload[] {
  if (!value || typeof value !== "object") return out;
  if (Buffer.isBuffer(value)) return out;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectInlineImages(item, actionName, out);
    }
    return out;
  }

  const dataBlock = isDataImageBlock(value);
  for (const [key, nested] of Object.entries(value)) {
    if (dataBlock && key === "data") {
      out.push({ base64: nested as string, mediaType: (value as { mimeType: string }).mimeType });
      continue;
    }
    if (shouldRedactBase64Key(key, actionName) && typeof nested === "string") {
      out.push({ base64: nested, mediaType: "image/png" });
      continue;
    }
    collectInlineImages(nested, actionName, out);
  }
  return out;
}

export function collectInlineImagePayloads(
  value: unknown,
  actionName?: string,
  out: string[] = [],
): string[] {
  for (const image of collectInlineImages(value, actionName, [])) out.push(image.base64);
  return out;
}

export function redactInlineImagePayloads(value: unknown, actionName?: string): unknown {
  if (!value || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactInlineImagePayloads(item, actionName));
  }

  const dataBlock = isDataImageBlock(value);
  // fromEntries defines own properties, so a `__proto__` key stays data.
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      (dataBlock && key === "data") ||
      (shouldRedactBase64Key(key, actionName) && typeof nested === "string")
        ? REDACTED_INLINE_IMAGE
        : redactInlineImagePayloads(nested, actionName),
    ]),
  );
}

export function mergeAgentEvidence(...parts: Array<AgentEvidence | undefined>): AgentEvidence {
  return {
    modalities: parts.flatMap((p) => p?.modalities ?? []),
  };
}

export function buildAgentEvidenceFromStepFinished(event: AgentStepFinishedEvent): AgentEvidence {
  const modalities: AgentEvidence["modalities"] = [];
  if (event.reasoning) {
    modalities.push({ type: "text", content: event.reasoning });
  }

  const result = event.toolOutput.result;
  if (result === undefined || result === null) {
    return { modalities };
  }

  if (typeof result === "string") {
    modalities.push({ type: "text", content: result });
  } else if (
    typeof result === "number" ||
    typeof result === "boolean" ||
    typeof result === "bigint"
  ) {
    modalities.push({ type: "text", content: String(result) });
  } else if (Buffer.isBuffer(result)) {
    modalities.push({
      type: "image",
      bytes: result,
      mediaType: "image/png",
    });
  } else if (typeof result === "object") {
    for (const image of collectInlineImages(result, event.actionName, [])) {
      try {
        modalities.push({
          type: "image",
          bytes: Buffer.from(image.base64, "base64"),
          mediaType: image.mediaType,
        });
      } catch {
        // Malformed base64; skip the image and keep the JSON modality.
      }
    }
    modalities.push({
      type: "json",
      content: redactInlineImagePayloads(result, event.actionName),
    });
  }

  return { modalities };
}
