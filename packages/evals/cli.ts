// Must stay FIRST — silences braintrust's import-time OpenTelemetry warning
// before any transitive import evaluates it. Everything that eventually
// pulls in braintrust goes through dynamic import() below so this runs
// before braintrust's module body.
import "./silence-warnings.js";

import process from "node:process";
import { loadEvalsEnv } from "./evalsEnv.js";
loadEvalsEnv();

// Register tsx's ESM loader so dynamic `import()` of .ts task files resolves
// NodeNext-style .js specifiers (`"../fixtures/index.js"` → the real .ts
// source). In source mode (tsx already active) this is a no-op; in built
// mode (node running dist/cli/cli.js) this is what lets task files load.
await (async () => {
  try {
    const tsxApi = (await import("tsx/esm/api")) as {
      register: () => unknown;
    };
    tsxApi.register();
  } catch {}
})();

// Imports below are deferred to dynamic `await import(...)` inside the
// main IIFE so any braintrust transitive import happens AFTER
// silence-warnings has patched console.warn. Static import here would
// evaluate braintrust's module body before our top-level code runs and
// let its OTel warning through.

import { red } from "./tui/format.js";
import { getCurrentDirPath, getRuntimeTasksRoot } from "./runtimePaths.js";
import type { TaskRegistry } from "./framework/types.js";

const ENTRY_DIR = getCurrentDirPath();

const args = process.argv.slice(2);

(async () => {
  let shuttingDown = false;
  const handleSignal = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const code = signal === "SIGINT" ? 130 : 143;
    try {
      const { cleanupActiveRunResources } = await import("./framework/runner.js");
      await cleanupActiveRunResources();
    } catch {}
    try {
      const { flush } = await import("braintrust");
      await flush();
    } catch {}
    try {
      const { resolveTraceTransport } = await import("./framework/langsmith.js");
      if (resolveTraceTransport() === "otel") {
        try {
          const { shutdownTracing } = await import("./framework/otel.js");
          await shutdownTracing();
        } catch {}
      }
    } catch {}
    process.exit(code);
  };
  process.on("SIGINT", () => void handleSignal("SIGINT"));
  process.on("SIGTERM", () => void handleSignal("SIGTERM"));

  const isQuietFlag = (a: string): boolean => a === "--quiet" || a === "-q";
  const replLaunch = args.length === 0 || args.every(isQuietFlag);

  // Argv mode: Esc behaves like Ctrl+C. The REPL has its own keypress
  // handler that does cooperative-then-aggressive abort instead — this
  // path is only active when no arg-less REPL is running.
  //
  // Note: raw mode disables the OS-level Ctrl+C → SIGINT translation,
  // so we forward it ourselves.
  let cleanupArgvInput = (): void => {};
  let armArgvInput = (): void => {};
  if (!replLaunch && args.length > 0 && process.stdin.isTTY) {
    const readline = await import("node:readline");
    const wasRaw = process.stdin.isRaw;
    readline.emitKeypressEvents(process.stdin);
    const { getActiveRun } = await import("./tui/liveRun.js");
    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean } | undefined): void => {
      if (!key) return;
      if (key.name === "escape") void handleSignal("SIGINT");
      else if (key.ctrl && key.name === "c") void handleSignal("SIGINT");
      // Live-board keys (`v` logs, `?` help); `?` arrives as a string, not a name.
      else getActiveRun()?.onKey?.(key.name ?? str);
    };
    armArgvInput = () => {
      process.stdin.setRawMode?.(true);
      process.stdin.on("keypress", onKeypress);
      process.stdin.resume();
    };
    cleanupArgvInput = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode?.(Boolean(wasRaw));
      process.stdin.pause();
    };
    armArgvInput();
  }

  let shouldMarkFirstRun = false;

  try {
    if (replLaunch) {
      const { startRepl } = await import("./tui/repl.js");
      const quiet = args.some(isQuietFlag);
      await startRepl(ENTRY_DIR, { quiet });
      return;
    }

    const { buildCommandTree, dispatch, tokenizeArgv } = await import("./tui/commandTree.js");

    let registry: TaskRegistry | null = null;
    const getRegistry = async (): Promise<TaskRegistry> => {
      if (!registry) {
        const { discoverTasks } = await import("./framework/discovery.js");
        registry = await discoverTasks(getRuntimeTasksRoot(), false);
      }
      return registry;
    };

    const tree = buildCommandTree();

    const tokens = tokenizeArgv(args);
    const outcome = await dispatch(tree, tokens, {
      entryDir: ENTRY_DIR,
      getRegistry,
      setRegistry: (r) => {
        registry = r;
      },
      abortRef: null,
      contextPath: null,
      // Welcome flows own stdin (raw-byte Esc/Ctrl+C listener + clack).
      // Release the Esc-exits-CLI handler first: left attached, Node's
      // keypress decoder re-emits a held Esc after its escape-sequence
      // timeout and kills the process mid-prompt.
      suspendInput: () => {
        cleanupArgvInput();
        return armArgvInput;
      },
    });

    if (outcome.kind === "ran") {
      const top = outcome.absolutePath[0];
      shouldMarkFirstRun = top !== "doctor" && top !== "setup" && !top.startsWith("welcome");
    }
  } catch (err) {
    console.error(red(`Error: ${(err as Error).message}`));
    process.exitCode = 1;
  } finally {
    if (shouldMarkFirstRun) {
      try {
        const { markFirstRunComplete } = await import("./tui/welcomeState.js");
        markFirstRunComplete(ENTRY_DIR);
      } catch {}
    }
    cleanupArgvInput();
  }
})();
