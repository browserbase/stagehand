import type { LogLine } from "./types/public/logs.js";

/**
 * Stagehand V3 Logging
 *
 * The legacy instance-binding functions remain as compatibility no-ops. Browser
 * service workers do not provide AsyncLocalStorage, and an approximation cannot
 * reliably preserve context across awaited work. Callers that need structured
 * instance logging should pass a logger explicitly; other messages use the
 * console fallback below.
 */

export function bindInstanceLogger(_instanceId: string, _logger: (line: LogLine) => void): void {
  // Kept as a compatibility no-op until the logger is replaced.
}

export function unbindInstanceLogger(_instanceId: string): void {
  // Kept as a compatibility no-op until the logger is replaced.
}

export function withInstanceLogContext<T>(_instanceId: string, fn: () => T): T {
  return fn();
}

/**
 * Writes legacy V3 logs to the console.
 */
export function v3Logger(line: LogLine): void {
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
