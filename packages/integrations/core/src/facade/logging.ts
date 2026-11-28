import { closeSync, constants, openSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { StagehandFacadeConfigError } from "./config.js";
import { sanitizeErrorMessage } from "../harness/redact.js";
import { sliceUtf16Safe, stringifyError } from "../harness/values.js";
import type { FacadeEnv } from "./contract.js";

const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|password|secret|token|api[_-]?key|signing[_-]?key)$/i;
const BINARY_OMITTED_PATTERN = /^\[binary omitted: \d+ characters\]$/;
const MAX_LOG_DEPTH = 64;

function omitBinaryData(value: string): string {
  return BINARY_OMITTED_PATTERN.test(value)
    ? value
    : `[binary omitted: ${value.length} characters]`;
}

function readProperty(target: object, key: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: (target as Record<string, unknown>)[key] };
  } catch {
    return { ok: false };
  }
}

function redactLogString(text: string): string {
  return sanitizeErrorMessage(text)
    .replace(
      /((?:authorization|cookie|password|api[_-]?key|signing[_-]?key|secret|token)["']?\s*[:=]\s*)(["'])(?:(?:\\.|(?!\2)[^\\\r\n])*(\2)|[^\r\n]*)/gi,
      (_match, prefix: string, quote: string, close: string | undefined) =>
        `${prefix}${quote}[redacted]${close ?? ""}`,
    )
    .replace(/((?:authorization|cookie)["']?[ \t]*[:=][ \t]*)(?!["'\s])[^\r\n]+/gi, "$1[redacted]")
    .replace(
      /((?:password|api[_-]?key|signing[_-]?key|secret|token)["']?[ \t]*[:=][ \t]*)[^\s"',;}]+/gi,
      "$1[redacted]",
    );
}

function defineOwnField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function sanitizeLogValue(value: unknown, ancestors: Set<object>, depth: number): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactLogString(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined;

  if (ancestors.has(value)) return "[Circular]";
  if (depth >= MAX_LOG_DEPTH) return "[MaxDepth]";

  ancestors.add(value);
  try {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (value instanceof RegExp) {
      return redactLogString(String(value));
    }
    if (value instanceof Error) {
      const serialized: Record<string, unknown> = {};
      for (const metaKey of ["name", "message"] as const) {
        const prop = readProperty(value, metaKey);
        if (!prop.ok) {
          defineOwnField(serialized, metaKey, "[Unreadable]");
        } else {
          const sanitized = sanitizeLogValue(prop.value, ancestors, depth + 1);
          if (sanitized !== undefined) defineOwnField(serialized, metaKey, sanitized);
        }
      }
      const stackProp = readProperty(value, "stack");
      if (!stackProp.ok) {
        defineOwnField(serialized, "stack", "[Unreadable]");
      } else if (typeof stackProp.value === "string") {
        defineOwnField(serialized, "stack", redactLogString(stackProp.value));
      }
      const causeProp = readProperty(value, "cause");
      if (!causeProp.ok) {
        defineOwnField(serialized, "cause", "[Unreadable]");
      } else if (causeProp.value !== undefined) {
        defineOwnField(
          serialized,
          "cause",
          sanitizeLogValue(causeProp.value, ancestors, depth + 1),
        );
      }
      for (const key of Object.keys(value)) {
        const redactedKey = redactLogString(key);
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          defineOwnField(serialized, redactedKey, "[redacted]");
          continue;
        }
        const prop = readProperty(value, key);
        if (!prop.ok) {
          defineOwnField(serialized, redactedKey, "[Unreadable]");
          continue;
        }
        if (key === "data" && typeof prop.value === "string") {
          defineOwnField(serialized, redactedKey, omitBinaryData(prop.value));
          continue;
        }
        const sanitized = sanitizeLogValue(prop.value, ancestors, depth + 1);
        if (sanitized !== undefined) defineOwnField(serialized, redactedKey, sanitized);
      }
      return serialized;
    }
    if (value instanceof Map) {
      const entries: unknown[] = [];
      for (const [entryKey, entryVal] of value.entries()) {
        const safeKey = sanitizeLogValue(entryKey, ancestors, depth + 1);
        const safeVal =
          typeof entryKey === "string" && SENSITIVE_KEY_PATTERN.test(entryKey)
            ? "[redacted]"
            : entryKey === "data" && typeof entryVal === "string"
              ? omitBinaryData(entryVal)
              : sanitizeLogValue(entryVal, ancestors, depth + 1);
        entries.push([
          safeKey === undefined ? null : safeKey,
          safeVal === undefined ? null : safeVal,
        ]);
      }
      return entries;
    }
    if (value instanceof Set) {
      const items: unknown[] = [];
      for (const entry of value.values()) {
        const sanitized = sanitizeLogValue(entry, ancestors, depth + 1);
        items.push(sanitized === undefined ? null : sanitized);
      }
      return items;
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        let entry: unknown;
        try {
          entry = value[index];
        } catch {
          items.push("[Unreadable]");
          continue;
        }
        const sanitized = sanitizeLogValue(entry, ancestors, depth + 1);
        items.push(sanitized === undefined ? null : sanitized);
      }
      return items;
    }

    let toJsonMethod: unknown;
    try {
      toJsonMethod = (value as { toJSON?: unknown }).toJSON;
    } catch {
      toJsonMethod = undefined;
    }
    if (typeof toJsonMethod === "function") {
      try {
        const converted = (toJsonMethod as () => unknown).call(value);
        if (converted !== value) {
          return sanitizeLogValue(converted, ancestors, depth + 1);
        }
      } catch {}
    }

    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const redactedKey = redactLogString(key);
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        defineOwnField(output, redactedKey, "[redacted]");
        continue;
      }
      let item: unknown;
      try {
        item = (value as Record<string, unknown>)[key];
      } catch {
        defineOwnField(output, redactedKey, "[Unreadable]");
        continue;
      }
      if (key === "data" && typeof item === "string") {
        defineOwnField(output, redactedKey, omitBinaryData(item));
        continue;
      }
      const sanitized = sanitizeLogValue(item, ancestors, depth + 1);
      if (sanitized !== undefined) defineOwnField(output, redactedKey, sanitized);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function redactToolLog(value: unknown, maxChars = 16_000): unknown {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  const sanitized = sanitizeLogValue(value, new Set<object>(), 0);
  const text = JSON.stringify(sanitized) ?? "null";
  return text.length > limit
    ? { preview: sliceUtf16Safe(text, limit), truncated: true, characters: text.length }
    : JSON.parse(text);
}

export function createFacadeLogger(env: FacadeEnv = process.env) {
  const file = env.STAGEHAND_FACADE_LOG_FILE;
  const level = env.STAGEHAND_FACADE_LOG_LEVEL ?? (file ? "calls" : "off");
  if (!["off", "calls", "debug"].includes(level))
    throw new StagehandFacadeConfigError(
      "STAGEHAND_FACADE_LOG_LEVEL must be off, calls, or debug.",
    );
  const parsedLimit = Number(env.STAGEHAND_FACADE_LOG_MAX_CHARS ?? 16_000);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 256 || parsedLimit > 1_000_000)
    throw new StagehandFacadeConfigError(
      "STAGEHAND_FACADE_LOG_MAX_CHARS must be between 256 and 1000000.",
    );
  const session = randomUUID();
  let descriptor: number | undefined;
  if (file && level !== "off")
    descriptor = openSync(
      file,
      constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
  const emit = (event: string, details: Record<string, unknown>) => {
    if (level === "off") return;
    const record = {
      timestamp: new Date().toISOString(),
      session,
      pid: process.pid,
      event,
      ...details,
    };
    let line: string;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
      line = JSON.stringify(sanitizeLogValue(record, new Set<object>(), 0)) + "\n";
    }
    try {
      if (descriptor !== undefined) writeSync(descriptor, line);
      else process.stderr.write(line);
    } catch {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {}
      }
      descriptor = undefined;
      process.stderr.write("Stagehand tool log write failed; subsequent log records use stderr.\n");
    }
  };
  return {
    emit,
    async call<Result>(
      id: string,
      name: string,
      args: unknown,
      execute: () => Promise<Result>,
    ): Promise<Result> {
      const started = performance.now();
      emit("tool.start", { id, name, arguments: redactToolLog(args, parsedLimit) });
      try {
        const result = await execute();
        const object = result as {
          isError?: boolean;
          content?: Array<{ type: string; text?: string; data?: string }>;
        };
        emit("tool.end", {
          id,
          name,
          durationMs: Math.round(performance.now() - started),
          status: object?.isError ? "error" : "ok",
          content: object?.content?.map((block) => ({
            type: block.type,
            characters: block.text?.length ?? block.data?.length ?? 0,
          })),
          ...(level === "debug" || object?.isError
            ? { result: redactToolLog(result, parsedLimit) }
            : {}),
        });
        return result;
      } catch (error) {
        emit("tool.end", {
          id,
          name,
          durationMs: Math.round(performance.now() - started),
          status: "error",
          error: redactToolLog(
            typeof error === "object" && error !== null ? error : stringifyError(error),
            parsedLimit,
          ),
        });
        throw error;
      }
    },
    close() {
      if (descriptor !== undefined) closeSync(descriptor);
      descriptor = undefined;
    },
  };
}
