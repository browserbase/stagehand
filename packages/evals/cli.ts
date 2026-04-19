/**
 * Evals CLI entry point.
 *
 * Modes:
 *   - `evals` (no args)          → interactive REPL
 *   - `evals run <target> …`     → single-shot run with rich progress
 *   - `evals list [tier]`        → list discovered tasks
 *   - `evals config [sub]`       → print / get / set defaults
 *   - `evals experiments [sub]`  → inspect / compare Braintrust runs
 *   - `evals new <tier> <cat> <name>` → scaffold a task file
 *   - `evals help` / `-h`        → help
 *
 * No child processes. All runs flow through framework/runEvals in-process.
 *
 * Build: packages/evals/cli.ts → dist/cli/cli.js via scripts/build-cli.ts.
 * The bundled file is the `"bin"` entry in package.json.
 */

// Must stay FIRST — silences braintrust's import-time OpenTelemetry warning
// before any transitive import evaluates it. Everything that eventually
// pulls in braintrust goes through dynamic import() below so this runs
// before braintrust's module body.
import "./silence-warnings.js";

import process from "node:process";
import dotenv from "dotenv";
dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);

// Register tsx's ESM loader so dynamic `import()` of .ts task files resolves
// NodeNext-style .js specifiers (`"../fixtures/index.js"` → the real .ts
// source). In source mode (tsx already active) this is a no-op; in built
// mode (node running dist/cli/cli.js) this is what lets task files load.
await (async () => {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — tsx's subpath export doesn't resolve under `moduleResolution: "node"`; resolved at runtime.
    const tsxApi = (await import("tsx/esm/api")) as {
      register: () => unknown;
    };
    tsxApi.register();
  } catch {
    // best-effort; if tsx isn't installed tasks that import .ts will fail
  }
})();

// Imports below are deferred to dynamic `await import(...)` inside the
// main IIFE so any braintrust transitive import happens AFTER
// silence-warnings has patched console.warn. Static import here would
// evaluate braintrust's module body before our top-level code runs and
// let its OTel warning through.

import { red } from "./tui/format.js";
import { getCurrentDirPath, getRuntimeTasksRoot } from "./runtimePaths.js";

/**
 * Directory of the running entry module. Differs between source and
 * built mode — tui/commands/config.ts uses it to locate evals.config.json.
 */
const ENTRY_DIR = getCurrentDirPath();

const args = process.argv.slice(2);

(async () => {
  // All dynamic imports — braintrust transitively loads here, AFTER
  // silence-warnings has patched console.warn.
  const { flush } = await import("braintrust");
  const { startRepl } = await import("./tui/repl.js");
  const {
    printHelp,
    printRunHelp,
    printListHelp,
    printNewHelp,
    printConfigHelp,
    printExperimentsHelp,
  } = await import("./tui/commands/help.js");
  const { printList } = await import("./tui/commands/list.js");
  const { handleConfig, readConfig } = await import("./tui/commands/config.js");
  const { handleExperiments } = await import("./tui/commands/experiments.js");
  const { runCommand } = await import("./tui/commands/run.js");
  const { scaffoldTask } = await import("./tui/commands/new.js");
  const { parseRunArgs, resolveRunOptions } = await import(
    "./tui/commands/parse.js"
  );
  const { discoverTasks } = await import("./framework/discovery.js");

  // Best-effort shutdown: flush Braintrust telemetry and exit with the
  // conventional signal code. Does not guarantee in-flight task
  // cancellation upstream; the goal is clean process shutdown with no
  // orphan browser sessions.
  let shuttingDown = false;
  const handleSignal = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const code = signal === "SIGINT" ? 130 : 143;
    try {
      await flush();
    } catch {
      // ignore
    }
    process.exit(code);
  };
  process.on("SIGINT", () => void handleSignal("SIGINT"));
  process.on("SIGTERM", () => void handleSignal("SIGTERM"));

  async function executeRun(tokens: string[]): Promise<void> {
    const flags = parseRunArgs(tokens);
    const configFile = readConfig(ENTRY_DIR);
    const resolved = resolveRunOptions(
      flags,
      configFile.defaults,
      process.env,
      configFile.core,
    );

    if (flags.legacy) {
      const { runLegacy } = await import("./tui/commands/legacy.js");
      const registry = await discoverTasks(getRuntimeTasksRoot(), false);
      await runLegacy(resolved, flags, registry);
      return; // unreachable — runLegacy calls process.exit
    }

    await runCommand(resolved);
  }

  try {
    if (args.length === 0) {
      await startRepl(ENTRY_DIR);
      return;
    }

    const command = args[0].toLowerCase();
    const subArgs = args.slice(1);
    const wantsHelp = subArgs.includes("--help") || subArgs.includes("-h");

    switch (command) {
      case "run": {
        if (wantsHelp) {
          printRunHelp();
          return;
        }
        await executeRun(subArgs);
        return;
      }

      case "list": {
        if (wantsHelp) {
          printListHelp();
          return;
        }
        const detailed =
          subArgs.includes("--detailed") || subArgs.includes("-d");
        const tierFilter = subArgs.find((a) => !a.startsWith("-"));
        const tasksRoot = getRuntimeTasksRoot();
        const registry = await discoverTasks(tasksRoot, false);
        printList(registry, tierFilter, detailed);
        return;
      }

      case "config": {
        if (wantsHelp) {
          printConfigHelp();
          return;
        }
        await handleConfig(subArgs, ENTRY_DIR);
        return;
      }

      case "experiments": {
        if (wantsHelp && subArgs.length === 0) {
          printExperimentsHelp();
          return;
        }
        await handleExperiments(subArgs);
        return;
      }

      case "new": {
        if (wantsHelp) {
          printNewHelp();
          return;
        }
        scaffoldTask(subArgs);
        return;
      }

      case "help":
      case "--help":
      case "-h":
        printHelp();
        return;

      default: {
        // Unknown first arg → treat as run target: `evals act` == `evals run act`
        await executeRun(args);
        return;
      }
    }
  } catch (err) {
    console.error(red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
})();
