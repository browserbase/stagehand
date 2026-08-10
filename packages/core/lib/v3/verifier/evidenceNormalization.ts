import type { AgentStepFinishedEvent } from "../types/public/agentEvidenceEvents.js";
import type { AgentEvidence } from "./types.js";

export const REDACTED_INLINE_IMAGE = "[redacted inline image payload]";

const INLINE_IMAGE_KEYS = new Set(["screenshotBase64"]);

function shouldRedactBase64Key(key: string, actionName?: string): boolean {
  return (
    INLINE_IMAGE_KEYS.has(key) ||
    (actionName === "screenshot" && key === "base64")
  );
}

export function collectInlineImagePayloads(
  value: unknown,
  actionName?: string,
  out: string[] = [],
): string[] {
  if (!value || typeof value !== "object") return out;
  if (Buffer.isBuffer(value)) return out;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectInlineImagePayloads(item, actionName, out);
    }
    return out;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (shouldRedactBase64Key(key, actionName) && typeof nested === "string") {
      out.push(nested);
      continue;
    }
    collectInlineImagePayloads(nested, actionName, out);
  }
  return out;
}

export function redactInlineImagePayloads(
  value: unknown,
  actionName?: string,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactInlineImagePayloads(item, actionName));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] =
      shouldRedactBase64Key(key, actionName) && typeof nested === "string"
        ? REDACTED_INLINE_IMAGE
        : redactInlineImagePayloads(nested, actionName);
  }
  return out;
}

export function mergeAgentEvidence(
  ...parts: Array<AgentEvidence | undefined>
): AgentEvidence {
  return {
    modalities: parts.flatMap((p) => p?.modalities ?? []),
  };
}

export function buildAgentEvidenceFromStepFinished(
  event: AgentStepFinishedEvent,
): AgentEvidence {
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
    for (const imageBase64 of collectInlineImagePayloads(
      result,
      event.actionName,
    )) {
      try {
        modalities.push({
          type: "image",
          bytes: Buffer.from(imageBase64, "base64"),
          mediaType: "image/png",
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
