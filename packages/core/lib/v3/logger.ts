import type { LogLine } from "./types/public/logs.js";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stagehand V3 Logging
 *
 * Design goals:
 * - Support concurrent V3 instances with independent logger configuration
 * - Each V3 instance has its own StagehandLogger (handles usePino, verbose, externalLogger)
 * - Provide AsyncLocalStorage-based routing for backward compatibility with handler code
 * - Prevent cross-talk between concurrent instances
 *
 * How it works:
 * - Each V3 instance creates a StagehandLogger in its constructor (per-instance config)
 * - bindInstanceLogger()/unbindInstanceLogger(): registers logger callback per instance ID
 * - withInstanceLogContext(): establishes AsyncLocalStorage context for an async operation
 * - v3Logger(): routes logs using AsyncLocalStorage with console fallback
 *
 * ⚠️ CONTEXT LOSS SCENARIOS:
 * 1. setTimeout/setInterval callbacks lose context (runs outside AsyncLocalStorage scope)
 * 2. Event emitters (EventEmitter.on) lose context (callback invoked outside scope)
 * 3. Fire-and-forget promises (void promise) lose context if they don't complete synchronously
 * 4. Third-party library callbacks may lose context depending on implementation
 *
 * WORKAROUND for context loss:
 * - Use explicit logger parameter instead of v3Logger()
 * - Wrap callback in withInstanceLogContext() manually
 * - Or let logs fall back to console (acceptable for edge cases)
 */

// Per-instance routing using AsyncLocalStorage
const logContext = new AsyncLocalStorage<string>();
const instanceLoggers = new Map<string, (line: LogLine) => void>();

export function bindInstanceLogger(
  instanceId: string,
  logger: (line: LogLine) => void,
): void {
  instanceLoggers.set(instanceId, logger);
}

export function unbindInstanceLogger(instanceId: string): void {
  instanceLoggers.delete(instanceId);
}

export function withInstanceLogContext<T>(instanceId: string, fn: () => T): T {
  return logContext.run(instanceId, fn);
}

/**
 * Routes logs to the appropriate instance logger based on AsyncLocalStorage context.
 * Falls back to console output if no instance context is available.
 */
export function v3Logger(line: LogLine): void {
  const id = logContext.getStore();
  if (id) {
    const fn = instanceLoggers.get(id);
    if (fn) {
      const enriched: LogLine = {
        ...line,
        auxiliary: {
          ...(line.auxiliary || {}),
        },
      };
      try {
        fn(enriched);
        return;
      } catch {
        // fallback to console below
      }
    }
  }

  // Fallback: log to console when no instance context
  const ts = line.timestamp ?? new Date().toISOString();
  const lvl = line.level ?? 1;
  const levelStr = lvl === 0 ? "ERROR" : lvl === 2 ? "DEBUG" : "INFO";
  let output = `[${ts}] ${levelStr}: ${line.message}`;

  if (line.auxiliary) {
    for (const [key, { value, type }] of Object.entries(line.auxiliary)) {
      let formattedValue = value;
      if (type === "object") {
        try {
          formattedValue = JSON.stringify(JSON.parse(value), null, 2)
            .split("\n")
            .map((line, i) => (i === 0 ? line : `    ${line}`))
            .join("\n");
        } catch {
          formattedValue = value;
        }
      }
      output += `\n    ${key}: ${formattedValue}`;
    }
  }

  if (lvl === 0) {
    console.error(output);
  } else if (lvl === 2) {
    (console.debug ?? console.log)(output);
  } else {
    console.log(output);
  }
}
