import type { LogLine } from "./types/public/logs";
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
 * - bindInstanceLogger()/unbindInstanceLogger(): registers external logger callback per instance ID
 * - withInstanceLogContext(): establishes AsyncLocalStorage context for an async operation
 * - v3Logger(): routes logs using AsyncLocalStorage OR falls back to console
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

type Verbosity = 0 | 1 | 2;

type MinimalLogger = {
  log: (line: LogLine) => void;
  setVerbosity: (v: Verbosity) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
};

const isNode = typeof process !== "undefined" && !!process.versions?.node;

function makeNoop(): MinimalLogger {
  let level: Verbosity = 1;
  const noop = () => {};
  return {
    setVerbosity(v) {
      level = v;
    },
    log: (line) => {
      // Respect verbosity semantics even when no-op to satisfy lints
      // and keep future extension simple.
      if ((line.level ?? 1) <= level) {
        // intentionally no output
      }
    },
    error: noop,
    info: noop,
    debug: noop,
  };
}

let current: MinimalLogger = makeNoop();
let loggerInitPromise: Promise<void> | null = null;
let isInitializing = false;

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
 * Initialize the global V3 logger backend.
 * - When disablePino is false (default), uses the Stagehand Pino logger for rich console output.
 * - When disablePino is true, uses a lightweight console logger that respects verbosity.
 *
 * Note: This function never binds an external logger globally. Use bindInstanceLogger()
 * with withInstanceLogContext() for per-instance routing.
 *
 * This function is idempotent and caches the initialization promise. The first call performs
 * the full async initialization, and subsequent calls return the cached promise immediately.
 * This prevents race conditions while maintaining performance for multiple V3 instances.
 *
 * IMPORTANT: Logger configuration is "first-wins" - the options from the first V3 instance
 * to call init() will determine the global logger settings (verbose, disablePino, etc.).
 * Subsequent calls with different options will return the already-initialized logger.
 */
export async function initV3Logger(
  opts: { verbose?: Verbosity; disablePino?: boolean; pretty?: boolean } = {},
): Promise<void> {
  // Fast path: already initialized
  if (loggerInitPromise && !isInitializing) {
    return loggerInitPromise;
  }

  // Check-then-act race protection using synchronous flag
  if (isInitializing) {
    // Another concurrent call is initializing, wait for it
    while (isInitializing) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    // By now, loggerInitPromise should be set
    if (loggerInitPromise) {
      return loggerInitPromise;
    }
  }

  // Double-check after acquiring initialization rights
  if (loggerInitPromise) {
    return loggerInitPromise;
  }

  // Mark that we're initializing to prevent concurrent initialization
  isInitializing = true;

  try {
    // Create and cache the initialization promise
    loggerInitPromise = (async () => {
      try {
        if (!isNode) {
          current = makeNoop();
          return;
        }
        // Decide whether to use Pino-backed logger
        const usePino = !opts.disablePino;

        if (!usePino) {
          // Lightweight console logger for environments without Pino
          let level: Verbosity = opts.verbose ?? 1;

          const print = (line: LogLine) => {
            const ts = line.timestamp ?? new Date().toISOString();
            const lvl = line.level ?? 1;
            const levelStr = lvl === 0 ? "ERROR" : lvl === 2 ? "DEBUG" : "INFO";

            // Format like Pino: [timestamp] LEVEL: message
            let output = `[${ts}] ${levelStr}: ${line.message}`;

            // Add auxiliary data on separate indented lines (like Pino pretty format)
            if (line.auxiliary) {
              for (const [key, { value, type }] of Object.entries(
                line.auxiliary,
              )) {
                let formattedValue = value;
                if (type === "object") {
                  try {
                    // Pretty print objects with indentation
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
          };

          const toAuxiliary = (
            data?: Record<string, unknown>,
          ): LogLine["auxiliary"] | undefined => {
            if (!data) return undefined;
            const entries = Object.entries(data)
              .filter(([, v]) => {
                // Skip undefined values
                if (v === undefined) return false;
                // Skip empty objects/arrays
                if (typeof v === "object" && v !== null) {
                  const isEmpty = Array.isArray(v)
                    ? v.length === 0
                    : Object.keys(v).length === 0;
                  if (isEmpty) return false;
                }
                return true;
              })
              .map(([k, v]) => {
                let type: LogLine["auxiliary"][string]["type"] = "string";
                if (typeof v === "boolean") type = "boolean";
                else if (typeof v === "number")
                  type = Number.isInteger(v) ? "integer" : "float";
                return [k, { value: String(v), type }];
              });
            return entries.length > 0 ? Object.fromEntries(entries) : undefined;
          };

          current = {
            setVerbosity(v) {
              level = v;
            },
            log(line) {
              if ((line.level ?? 1) <= level) print(line);
            },
            error(msg, data) {
              print({
                category: "log",
                message: msg,
                level: 0,
                auxiliary: toAuxiliary(data),
              });
            },
            info(msg, data) {
              print({
                category: "log",
                message: msg,
                level: 1,
                auxiliary: toAuxiliary(data),
              });
            },
            debug(msg, data) {
              print({
                category: "log",
                message: msg,
                level: 2,
                auxiliary: toAuxiliary(data),
              });
            },
          };
          return;
        }

        // Lazy import to avoid pulling pino into non-Pino paths (and browser bundles)
        const { StagehandLogger } = await import("../logger");
        const stagehand = new StagehandLogger({
          pretty: opts.pretty ?? true,
          usePino: true,
        });
        if (opts.verbose !== undefined) stagehand.setVerbosity(opts.verbose);

        current = {
          log: (l) => stagehand.log(l),
          setVerbosity: (v) => stagehand.setVerbosity(v),
          error: (m, d) => stagehand.error(m, d),
          info: (m, d) => stagehand.info(m, d),
          debug: (m, d) => stagehand.debug(m, d),
        };
      } finally {
        // Mark initialization as complete (runs when async work finishes)
        isInitializing = false;
      }
    })();

    return loggerInitPromise;
  } catch (err) {
    isInitializing = false;
    throw err;
  }
}

export function getV3Logger(): MinimalLogger {
  return current;
}

// Convenience for structured logging call sites
export function v3Logger(line: LogLine): void {
  const id = logContext.getStore();
  if (id) {
    const fn = instanceLoggers.get(id);
    if (fn) {
      const enriched: LogLine = {
        ...line,
        auxiliary: {
          ...(line.auxiliary || {}),
          instanceId: { value: id, type: "string" },
        },
      };
      try {
        fn(enriched);
        return;
      } catch {
        // fallback to global current below
      }
    }
  }
  current.log(line);
}

export function setV3Verbosity(v: Verbosity): void {
  current.setVerbosity(v);
}
