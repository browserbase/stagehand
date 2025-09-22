import type { LogLine } from "./types/log";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stagehand V3 Logging
 *
 * Design goals:
 * - Provide a single global logging sink (Pino or console) for general output.
 * - Support concurrent V3 instances by routing logs to an instance-bound external logger
 *   (e.g., Braintrust EvalLogger) without cross-talk.
 * - Keep the public API simple: per-instance binding happens via V3, not here.
 *
 * How it works:
 * - initV3Logger(): initializes the global logger backend (Pino if enabled, otherwise a
 *   lightweight console logger). No external logger is bound globally.
 * - bindInstanceLogger()/unbindInstanceLogger(): registers an external logger callback per
 *   instance id for use by v3Logger.
 * - withInstanceLogContext(): establishes a context so v3Logger can route logs to the
 *   correct instance's external logger during that call tree.
 * - v3Logger(): preferred entrypoint for emitting structured logs from V3 internals and handlers.
 *   It routes to the instance logger when available, or falls back to the global backend.
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
 */
export async function initV3Logger(
  opts: { verbose?: Verbosity; disablePino?: boolean; pretty?: boolean } = {},
): Promise<void> {
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
      const cat = line.category ?? "log";
      const aux = line.auxiliary ? ` ${JSON.stringify(line.auxiliary)}` : "";
      const msg = `${ts}::[v3:${cat}] ${line.message}${aux}`;
      const lvl = line.level ?? 1;
      if (lvl === 0) {
        console.error(msg);
      } else if (lvl === 2) {
        (console.debug ?? console.log)(msg);
      } else {
        console.log(msg);
      }
    };

    const toAuxiliary = (
      data?: Record<string, unknown>,
    ): LogLine["auxiliary"] | undefined => {
      if (!data) return undefined;
      const entries = Object.entries(data).map(([k, v]) => {
        let type: LogLine["auxiliary"][string]["type"] = "string";
        if (typeof v === "boolean") type = "boolean";
        else if (typeof v === "number")
          type = Number.isInteger(v) ? "integer" : "float";
        return [k, { value: String(v), type }];
      });
      return Object.fromEntries(entries);
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
  const { StagehandLogger } = await import("@/lib/logger");
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
