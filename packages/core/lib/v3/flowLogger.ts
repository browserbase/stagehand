import { randomUUID } from "node:crypto";
import { v3Logger } from "./logger";

type FlowPrefixOptions = {
  includeAction?: boolean;
  includeStep?: boolean;
  includeTask?: boolean;
};

const MAX_ARG_LENGTH = 500;

let currentTaskId: string | null = null;
let currentStepId: string | null = null;
let currentActionId: string | null = null;
let currentStepLabel: string | null = null;
let currentActionLabel: string | null = null;

function generateId(label: string): string {
  try {
    return randomUUID();
  } catch {
    const fallback =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return fallback;
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_ARG_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ARG_LENGTH)}…`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `'${value}'`;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return "[unserializable array]";
    }
  }
  if (typeof value === "object" && value !== null) {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return "[unserializable object]";
    }
  }
  if (value === undefined) {
    return "undefined";
  }
  return truncate(String(value));
}

function formatArgs(args?: unknown | unknown[]): string {
  if (args === undefined) {
    return "";
  }
  const normalized = (Array.isArray(args) ? args : [args]).filter(
    (entry) => entry !== undefined,
  );
  const rendered = normalized
    .map((entry) => formatValue(entry))
    .filter((entry) => entry.length > 0);
  return rendered.join(", ");
}

function formatTag(label: string, id: string | null): string {
  return `[${label} #${shortId(id)}]`;
}

function formatCdpTag(sessionId?: string | null): string {
  if (!sessionId) return "[CDP]";
  return `[CDP #${shortId(sessionId).toUpperCase()}]`;
}

function shortId(id: string | null): string {
  if (!id) return "-";
  const trimmed = id.slice(-4);
  return trimmed;
}

function ensureTaskContext(): void {
  if (!currentTaskId) {
    currentTaskId = generateId("task");
  }
}

function ensureStepContext(defaultLabel?: string): void {
  if (defaultLabel) {
    currentStepLabel = defaultLabel.toUpperCase();
  }
  if (!currentStepLabel) {
    currentStepLabel = "STEP";
  }
  if (!currentStepId) {
    currentStepId = generateId("step");
  }
}

function ensureActionContext(defaultLabel?: string): void {
  if (defaultLabel) {
    currentActionLabel = defaultLabel.toUpperCase();
  }
  if (!currentActionLabel) {
    currentActionLabel = "ACTION";
  }
  if (!currentActionId) {
    currentActionId = generateId("action");
  }
}

function buildPrefix({
  includeAction = true,
  includeStep = true,
  includeTask = true,
}: FlowPrefixOptions = {}): string {
  const parts: string[] = [];
  if (includeTask) {
    ensureTaskContext();
    parts.push(formatTag("TASK", currentTaskId));
  }
  if (includeStep) {
    ensureStepContext();
    const label = currentStepLabel ?? "STEP";
    parts.push(formatTag(label, currentStepId));
  }
  if (includeAction) {
    ensureActionContext();
    const actionLabel = currentActionLabel ?? "ACTION";
    parts.push(formatTag(actionLabel, currentActionId));
  }
  return parts.join(" ");
}

export function logTaskProgress({
  invocation,
  args,
}: {
  invocation: string;
  args?: unknown | unknown[];
}): string {
  currentTaskId = generateId("task");
  currentStepId = null;
  currentActionId = null;
  currentStepLabel = null;
  currentActionLabel = null;

  const call = `${invocation}(${formatArgs(args)})`;
  const message = `${buildPrefix({
    includeTask: true,
    includeStep: false,
    includeAction: false,
  })} ${call}`;
  v3Logger({
    category: "flow",
    message,
    level: 2,
  });
  return currentTaskId;
}

export function logStepProgress({
  invocation,
  args,
  label,
}: {
  invocation: string;
  args?: unknown | unknown[];
  label: string;
}): string {
  ensureTaskContext();
  currentStepId = generateId("step");
  currentStepLabel = label.toUpperCase();
  currentActionId = null;
  currentActionLabel = null;

  const call = `${invocation}(${formatArgs(args)})`;
  const message = `${buildPrefix({
    includeTask: true,
    includeStep: true,
    includeAction: false,
  })} ${call}`;
  v3Logger({
    category: "flow",
    message,
    level: 2,
  });
  return currentStepId;
}

export function logActionProgress({
  actionType,
  target,
  args,
}: {
  actionType: string;
  target?: string;
  args?: unknown | unknown[];
}): string {
  ensureTaskContext();
  ensureStepContext();
  currentActionId = generateId("action");
  currentActionLabel = actionType.toUpperCase();
  const details: string[] = [`${actionType}`];
  if (target) {
    details.push(`target=${target}`);
  }
  const argString = formatArgs(args);
  if (argString) {
    details.push(`args=[${argString}]`);
  }

  const message = `${buildPrefix({
    includeTask: true,
    includeStep: true,
    includeAction: true,
  })} ${details.join(" ")}`;
  v3Logger({
    category: "flow",
    message,
    level: 2,
  });
  return currentActionId;
}

export function logCdpMessage({
  method,
  params,
  sessionId,
}: {
  method: string;
  params?: object;
  sessionId?: string | null;
}): void {
  const args = params ? formatArgs(params) : "";
  const call = args ? `${method}(${args})` : `${method}()`;
  const prefix = buildPrefix({
    includeTask: true,
    includeStep: true,
    includeAction: true,
  });
  const rawMessage = `${prefix} ${formatCdpTag(sessionId)} ${call}`;
  const message =
    rawMessage.length > 120 ? `${rawMessage.slice(0, 117)}...` : rawMessage;
  v3Logger({
    category: "flow",
    message,
    level: 2,
  });
}

export function clearFlowContext(): void {
  currentTaskId = null;
  currentStepId = null;
  currentActionId = null;
  currentStepLabel = null;
  currentActionLabel = null;
}
