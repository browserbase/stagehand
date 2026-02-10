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
  const runShutdownWithKeepAlive = (reason: string) => {
    const keepAlive = setInterval(() => {}, 250);
    const hardTimeout = setTimeout(() => {
      opts.logger({
        category: "v3",
        message: "shutdown timeout reached; proceeding without full cleanup",
        level: 0,
      });
      clearInterval(keepAlive);
    }, SHUTDOWN_HARD_TIMEOUT_MS);

    void opts
      .shutdownAll(reason)
      .catch(() => {})
      .finally(() => {
        clearTimeout(hardTimeout);
        clearInterval(keepAlive);
      });
  };

  const toError = (value: unknown): Error =>
    value instanceof Error ? value : new Error(String(value));

  let shuttingDown = false;
  const startShutdown = (signalLabel: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    opts.logger({
      category: "v3",
      message: `${signalLabel}: initiating shutdown`,
      level: 0,
    });
    runShutdownWithKeepAlive(`signal ${signalLabel}`);
  };

  process.on("SIGINT", () => {
    startShutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    startShutdown("SIGTERM");
  });

  const onUncaughtException = (err: unknown) => {
    const errToThrow = toError(err);
    opts.logger({
      category: "v3",
      message: "uncaughtException",
      level: 0,
      auxiliary: { err: { value: String(err), type: "string" } },
    });
    process.off("unhandledRejection", onUnhandledRejection);
    void opts
      .shutdownAll(`uncaughtException: ${String(err)}`)
      .catch(() => {})
      .finally(() => {
        setImmediate(() => {
          throw errToThrow;
        });
      });
  };

  const onUnhandledRejection = (reason: unknown) => {
    const errToThrow = toError(reason);
    opts.logger({
      category: "v3",
      message: "unhandledRejection",
      level: 0,
      auxiliary: { reason: { value: String(reason), type: "string" } },
    });
    process.off("uncaughtException", onUncaughtException);
    void opts
      .shutdownAll(`unhandledRejection: ${String(reason)}`)
      .catch(() => {})
      .finally(() => {
        setImmediate(() => {
          throw errToThrow;
        });
      });
  };

  process.once("uncaughtException", onUncaughtException);
  process.once("unhandledRejection", onUnhandledRejection);
}
