import { closeSync, constants, openSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sanitizeErrorMessage } from "../harness/redact.js";

export function redactToolLog(value: unknown, maxChars = 16_000): unknown {
  const seen = new WeakSet<object>();
  const text =
    JSON.stringify(value, (key, item: unknown) => {
      if (/^(?:authorization|cookie|password|secret|token|api[_-]?key|signingKey)$/i.test(key))
        return "[redacted]";
      if (key === "data" && typeof item === "string" && item.length > 256)
        return `[binary omitted: ${item.length} characters]`;
      if (typeof item === "string")
        return sanitizeErrorMessage(item).replace(
          /((?:password|api[_-]?key|secret|token)\s*[:=]\s*["']?)[^\s"',;}]+/gi,
          "$1[redacted]",
        );
      if (typeof item === "bigint") return String(item);
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }) ?? "null";
  return text.length > maxChars
    ? { preview: text.slice(0, maxChars), truncated: true, characters: text.length }
    : JSON.parse(text);
}

export function createFacadeLogger(env: NodeJS.ProcessEnv = process.env) {
  const file = env.STAGEHAND_FACADE_LOG_FILE;
  const level = env.STAGEHAND_FACADE_LOG_LEVEL ?? (file ? "calls" : "off");
  if (!["off", "calls", "debug"].includes(level))
    throw new Error("STAGEHAND_FACADE_LOG_LEVEL must be off, calls, or debug.");
  const parsedLimit = Number(env.STAGEHAND_FACADE_LOG_MAX_CHARS ?? 16_000);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 256 || parsedLimit > 1_000_000)
    throw new Error("STAGEHAND_FACADE_LOG_MAX_CHARS must be between 256 and 1000000.");
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
    const line =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        session,
        pid: process.pid,
        event,
        ...details,
      }) + "\n";
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
          error: redactToolLog(String(error), parsedLimit),
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
