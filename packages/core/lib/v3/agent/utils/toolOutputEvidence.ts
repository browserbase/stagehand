import type { AgentStepFinishedEvent } from "../../types/public/agentEvidenceEvents.js";

const ERROR_STRING_LIMIT = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeError(value: unknown): string | undefined {
  if (value === undefined || value === null || value === false) {
    return undefined;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? String(value);
  } catch {
    serialized = String(value);
  }
  if (serialized.length <= ERROR_STRING_LIMIT) {
    return serialized;
  }
  return `${serialized.slice(0, ERROR_STRING_LIMIT)}... [truncated]`;
}

function statusCandidates(toolResult: unknown): Record<string, unknown>[] {
  if (!isRecord(toolResult)) {
    return [];
  }

  const candidates = [toolResult];
  const output = toolResult.output;
  if (isRecord(output)) {
    candidates.push(output);
  }
  return candidates;
}

export function inferToolOutput(
  toolResult: unknown,
): AgentStepFinishedEvent["toolOutput"] {
  const candidates = statusCandidates(toolResult);
  const error = candidates
    .map((candidate) =>
      hasOwn(candidate, "error") ? normalizeError(candidate.error) : undefined,
    )
    .find((message): message is string => message !== undefined);

  const successFalse = candidates.some(
    (candidate) => candidate.success === false,
  );
  const isError = candidates.some((candidate) => Boolean(candidate.isError));

  return {
    ok: error === undefined && !isError && !successFalse,
    result: toolResult,
    error,
  };
}
