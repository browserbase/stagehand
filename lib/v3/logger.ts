import type { LogLine } from "@/types/log";

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

export async function initV3Logger(
  opts: {
    verbose?: Verbosity;
    disablePino?: boolean;
    pretty?: boolean;
    externalLogger?: (line: LogLine) => void;
  } = {},
): Promise<void> {
  if (!isNode) {
    current = makeNoop();
    return;
  }

  // Lazy import to avoid pulling pino into browser bundles
  const { StagehandLogger } = await import("@/lib/logger");

  const usePino = !opts.disablePino && !opts.externalLogger;
  const stagehand = new StagehandLogger(
    { pretty: opts.pretty ?? true, usePino },
    opts.externalLogger,
  );
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
  current.log(line);
}

export function setV3Verbosity(v: Verbosity): void {
  current.setVerbosity(v);
}
