import type { LogLine } from "../types/public/logs";

/**
 * Process-level shutdown guards for Stagehand.
 *
 * Installs SIGINT/SIGTERM/unhandledRejection/uncaughtException handlers
 * and keeps the event loop alive while shutdown runs, with a hard timeout.
 */

const SHUTDOWN_HARD_TIMEOUT_MS = 4000;

/**
 * Register global process guards that trigger shutdown.
 */
export function installShutdownGuards(opts: {
  logger: (line: LogLine) => void;
  shutdownAll: (reason: string) => Promise<void>;
}): void {
  let finalized = false;
  let reemitted = false;
  const finalize = (signalLabel?: "SIGINT" | "SIGTERM") => {
    if (finalized) return;
    finalized = true;
    if (signalLabel && !reemitted) {
      reemitted = true;
      try {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        process.kill(process.pid, signalLabel);
      } catch {
        // best-effort re-emit
      }
    }
  };

  const runShutdownWithKeepAlive = (
    reason: string,
    signalLabel?: "SIGINT" | "SIGTERM",
    onAfter?: () => void,
  ) => {
    let afterCalled = false;
    const callAfter = () => {
      if (afterCalled) return;
      afterCalled = true;
      onAfter?.();
    };
    const keepAlive = setInterval(() => {}, 250);
    const hardTimeout = setTimeout(() => {
      opts.logger({
        category: "v3",
        message: "shutdown timeout reached; proceeding without full cleanup",
        level: 0,
      });
      clearInterval(keepAlive);
      finalize(signalLabel);
      callAfter();
    }, SHUTDOWN_HARD_TIMEOUT_MS);

    void opts
      .shutdownAll(reason)
      .catch(() => {})
      .finally(() => {
        clearTimeout(hardTimeout);
        clearInterval(keepAlive);
        finalize(signalLabel);
        callAfter();
      });
  };

  const toError = (value: unknown): Error =>
    value instanceof Error ? value : new Error(String(value));

  let shuttingDown = false;
  const startShutdown = (args: {
    signalLabel?: "SIGINT" | "SIGTERM";
    reason: string;
    logLabel: string;
    onAfter?: () => void;
  }) => {
    if (shuttingDown) return;
    shuttingDown = true;
    opts.logger({
      category: "v3",
      message: args.logLabel,
      level: 0,
    });
    runShutdownWithKeepAlive(args.reason, args.signalLabel, args.onAfter);
  };

  const onSigint = () => {
    startShutdown({
      signalLabel: "SIGINT",
      reason: "signal SIGINT",
      logLabel: "SIGINT: initiating shutdown",
    });
  };
  const onSigterm = () => {
    startShutdown({
      signalLabel: "SIGTERM",
      reason: "signal SIGTERM",
      logLabel: "SIGTERM: initiating shutdown",
    });
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  const onUncaughtException = (err: unknown) => {
    const errToThrow = toError(err);
    process.off("unhandledRejection", onUnhandledRejection);
    opts.logger({
      category: "v3",
      message: "uncaughtException",
      level: 0,
      auxiliary: { err: { value: String(err), type: "string" } },
    });
    startShutdown({
      reason: `uncaughtException: ${String(err)}`,
      logLabel: "uncaughtException: initiating shutdown",
      onAfter: () => {
        setImmediate(() => {
          throw errToThrow;
        });
      },
    });
  };

  const onUnhandledRejection = (reason: unknown) => {
    const errToThrow = toError(reason);
    process.off("uncaughtException", onUncaughtException);
    opts.logger({
      category: "v3",
      message: "unhandledRejection",
      level: 0,
      auxiliary: { reason: { value: String(reason), type: "string" } },
    });
    startShutdown({
      reason: `unhandledRejection: ${String(reason)}`,
      logLabel: "unhandledRejection: initiating shutdown",
      onAfter: () => {
        setImmediate(() => {
          throw errToThrow;
        });
      },
    });
  };

  process.once("uncaughtException", onUncaughtException);
  process.once("unhandledRejection", onUnhandledRejection);
}
