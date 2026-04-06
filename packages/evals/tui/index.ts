/**
 * Evals CLI entry point.
 *
 * Two modes:
 *   - `evals` (no args) → launches interactive REPL
 *   - `evals run <target> [options]` → single-shot execution with rich output
 *   - `evals list` → list available tasks
 *   - `evals config` → show configuration
 *   - `evals help` → show help
 */

import process from "node:process";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);

import { startRepl } from "./repl.js";
import {
  printHelp,
  printRunHelp,
  printListHelp,
  printNewHelp,
  printConfigHelp,
} from "./commands/help.js";
import { printList } from "./commands/list.js";
import { printConfig } from "./commands/config.js";
import { runCommand } from "./commands/run.js";
import { scaffoldTask } from "./commands/new.js";
import { discoverTasks } from "../framework/discovery.js";
import { red, dim } from "./format.js";
import { getPackageRootDir } from "../runtimePaths.js";

function resolveTasksRoot(): string {
  return path.join(getPackageRootDir(), "tasks");
}

const args = process.argv.slice(2);

// No args → REPL mode
if (args.length === 0) {
  startRepl();
} else {
  // Single-command mode
  const command = args[0].toLowerCase();
  const subArgs = args.slice(1);
  const wantsHelp = subArgs.includes("--help") || subArgs.includes("-h");

  (async () => {
    try {
      switch (command) {
        case "run": {
          if (wantsHelp) { printRunHelp(); break; }
          const opts = parseRunArgs(subArgs);
          if (opts.environment) {
            process.env.EVAL_ENV = opts.environment;
          }
          if (opts.useApi) {
            process.env.USE_API = "true";
          }
          await runCommand(opts);
          break;
        }

        case "list": {
          if (wantsHelp) { printListHelp(); break; }
          const registry = await discoverTasks(resolveTasksRoot(), false);
          const tierFilter = subArgs[0];
          printList(registry, tierFilter);
          break;
        }

        case "config":
          if (wantsHelp) { printConfigHelp(); break; }
          printConfig();
          break;

        case "new":
          if (wantsHelp) { printNewHelp(); break; }
          scaffoldTask(subArgs);
          break;

        case "help":
        case "--help":
        case "-h":
          printHelp();
          break;

        default:
          // Treat unknown first arg as a run target: `evals act` → `evals run act`
          const opts = parseRunArgs(args);
          await runCommand(opts);
          break;
      }
    } catch (err) {
      console.error(red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  })();
}

// ---------------------------------------------------------------------------
// Argument parsing for single-command mode
// ---------------------------------------------------------------------------

interface ParsedRunArgs {
  target?: string;
  trials?: number;
  concurrency?: number;
  environment?: "LOCAL" | "BROWSERBASE";
  model?: string;
  provider?: string;
  useApi?: boolean;
}

function parseRunArgs(args: string[]): ParsedRunArgs {
  const result: ParsedRunArgs = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "-t" || arg === "--trials") {
      result.trials = parseInt(args[++i], 10);
    } else if (arg === "-c" || arg === "--concurrency") {
      result.concurrency = parseInt(args[++i], 10);
    } else if (arg === "-e" || arg === "--env") {
      const val = args[++i]?.toLowerCase();
      result.environment = val === "browserbase" ? "BROWSERBASE" : "LOCAL";
    } else if (arg === "-m" || arg === "--model") {
      result.model = args[++i];
    } else if (arg === "-p" || arg === "--provider") {
      result.provider = args[++i];
    } else if (arg === "--api") {
      result.useApi = true;
    } else if (!arg.startsWith("-")) {
      result.target = arg;
    }

    i++;
  }

  return result;
}
