import { LogLine } from "../types/public/logs";

export interface AgentAbortHandle {
  controller: AbortController;
  abort: (reason: string) => boolean;
  dispose: () => void;
}

export type SigtermCleanup = (() => void) | null;

export interface AgentRunAbortContext {
  signal: AbortSignal;
  stop: (reason: string) => boolean;
  cleanup: () => void;
}

export interface AgentLifecycleManager {
  beginRun(options?: { sigtermReason?: string }): AgentRunAbortContext;
  abortAll(reason: string): void;
}

export interface AgentRunManager {
  start(options: {
    enableAbort: boolean;
    sigtermReason?: string;
  }): { abortContext: AgentRunAbortContext | null; cleanup: () => void };
  stopActive(reason: string): boolean;
  isRunning(): boolean;
}

export function createAgentLifecycleManager(
  logger: (logLine: LogLine) => void,
): AgentLifecycleManager {
  const controllers = new Set<AbortController>();

  const abortController = (
    controller: AbortController,
    reason: string,
    { logReason }: { logReason: boolean },
  ): boolean => {
    if (controller.signal.aborted) {
      return false;
    }
    if (logReason) {
      logger({
        category: "agent",
        message: reason,
        level: 1,
      });
    }
    try {
      controller.abort(new Error(reason));
    } catch {
      controller.abort();
    }
    return true;
  };

  const createAbortHandle = (): AgentAbortHandle => {
    const controller = new AbortController();
    controllers.add(controller);
    let disposed = false;

    return {
      controller,
      abort: (reason: string) =>
        abortController(controller, reason, { logReason: true }),
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        controllers.delete(controller);
      },
    };
  };

  return {
    beginRun(options) {
      const handle = createAbortHandle();
      const detachSigterm =
        options?.sigtermReason !== undefined
          ? registerSigtermAbortHandler(() => {
              handle.abort(options.sigtermReason!);
            })
          : null;
      return {
        signal: handle.controller.signal,
        stop: handle.abort,
        cleanup: () => {
          detachSigterm?.();
          handle.dispose();
        },
      };
    },
    abortAll(reason: string) {
      let aborted = false;
      for (const controller of controllers) {
        const controllerAborted = abortController(controller, reason, {
          logReason: false,
        });
        aborted = aborted || controllerAborted;
      }
      if (aborted) {
        logger({
          category: "agent",
          message: reason,
          level: 1,
        });
      }
    },
  };
}

export function createAgentRunManager(
  lifecycle: AgentLifecycleManager,
): AgentRunManager {
  let running = false;
  let currentContext: AgentRunAbortContext | null = null;

  const clearContext = (context: AgentRunAbortContext | null) => {
    if (currentContext === context) {
      currentContext = null;
    }
    running = false;
  };

  return {
    start({ enableAbort, sigtermReason }) {
      if (running) {
        throw new Error(
          "agent.execute is already running. Call agent.stop() before starting another run.",
        );
      }
      running = true;

      if (!enableAbort) {
        currentContext = null;
        return {
          abortContext: null,
          cleanup: () => {
            clearContext(null);
          },
        };
      }

      const context = lifecycle.beginRun({ sigtermReason });
      currentContext = context;
      return {
        abortContext: context,
        cleanup: () => {
          context.cleanup();
          clearContext(context);
        },
      };
    },
    stopActive(reason) {
      return currentContext?.stop(reason) ?? false;
    },
    isRunning() {
      return running;
    },
  };
}

function registerSigtermAbortHandler(handler: () => void): SigtermCleanup {
  if (
    typeof process === "undefined" ||
    typeof process.on !== "function" ||
    typeof process.off !== "function"
  ) {
    return null;
  }
  process.on("SIGTERM", handler);
  return () => {
    process.off("SIGTERM", handler);
  };
}

