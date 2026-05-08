/**
 * Interactive REPL for the evals CLI.
 *
 * Shares all parsing + dispatch with the single-shot argv path in
 * cli.ts via tui/commands/parse.ts and tui/commands/*.
 */

import * as readline from "node:readline";
import { printBanner } from "./banner.js";
import { bb, dim, red, yellow } from "./format.js";
import {
  printHelp,
  printRunHelp,
  printListHelp,
  printNewHelp,
} from "./commands/help.js";
import { printList } from "./commands/list.js";
import { handleConfig } from "./commands/config.js";
import { handleExperiments } from "./commands/experiments.js";
import { runCommand } from "./commands/run.js";
import { scaffoldTask } from "./commands/new.js";
import { parseRunArgs, resolveRunOptions } from "./commands/parse.js";
import { readConfig } from "./commands/config.js";
import { discoverTasks } from "../framework/discovery.js";
import type { TaskRegistry } from "../framework/types.js";
import { getRuntimeTasksRoot } from "../runtimePaths.js";

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export async function startRepl(entryDir: string): Promise<void> {
  printBanner();

  const resolvedTasksRoot = getRuntimeTasksRoot();
  let registry: TaskRegistry;
  try {
    registry = await discoverTasks(resolvedTasksRoot, false);
    console.log(dim(`  Discovered ${registry.tasks.length} tasks\n`));
  } catch (err) {
    console.error(red(`  Failed to discover tasks: ${(err as Error).message}`));
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${bb("evals")} ${dim(">")} `,
  });

  // Esc → abort the in-flight run (cooperative). A second Esc within the
  // double-press window escalates to aggressive: the runner closes V3
  // sessions immediately so the in-flight task throws.
  let currentAbort: AbortController | null = null;
  let lastEscAt = 0;
  const DOUBLE_ESC_WINDOW_MS = 1500;

  const onKeypress = (
    _str: string,
    key: { name?: string; ctrl?: boolean } | undefined,
  ): void => {
    if (!key || key.name !== "escape") return;
    if (!currentAbort) return; // no run in flight; let readline handle Esc
    const now = Date.now();
    const isDouble = now - lastEscAt < DOUBLE_ESC_WINDOW_MS;
    lastEscAt = now;
    if (isDouble) {
      console.log(red("\n  ✗ Aborting immediately…"));
      currentAbort.abort("aggressive");
    } else {
      console.log(
        yellow(
          "\n  ⚠ Aborting after current task… (press Esc again to abort immediately)",
        ),
      );
      currentAbort.abort("cooperative");
    }
  };
  process.stdin.on("keypress", onKeypress);

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    const tokens = tokenize(trimmed);
    const command = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    // Help is only triggered when `--help`/`-h`/`help` sits immediately
    // after the command. Later positions are arguments or flag values and
    // must not be swallowed.
    const wantsHelp =
      args[0] === "--help" || args[0] === "-h" || args[0] === "help";

    try {
      switch (command) {
        case "run": {
          if (wantsHelp) {
            printRunHelp();
            break;
          }
          const flags = parseRunArgs(args);
          const configFile = readConfig(entryDir);
          const resolved = resolveRunOptions(
            flags,
            configFile.defaults,
            process.env,
            configFile.core,
          );
          currentAbort = new AbortController();
          try {
            await runCommand(resolved, registry, currentAbort.signal);
          } finally {
            currentAbort = null;
          }
          break;
        }

        case "list": {
          if (wantsHelp) {
            printListHelp();
            break;
          }
          const detailed = args.includes("--detailed") || args.includes("-d");
          const tierFilter = args.find((a) => !a.startsWith("-"));
          printList(registry, tierFilter, detailed);
          break;
        }

        case "config": {
          await handleConfig(args, entryDir);
          break;
        }

        case "experiments": {
          await handleExperiments(args);
          break;
        }

        case "new":
          if (wantsHelp) {
            printNewHelp();
            break;
          }
          {
            const task = scaffoldTask(args);
            if (task) {
              registry = await discoverTasks(resolvedTasksRoot, false);
            }
          }
          break;

        case "help":
          printHelp();
          break;

        case "clear":
          console.clear();
          break;

        case "exit":
        case "quit":
        case "q":
          console.log(dim("\n  Goodbye.\n"));
          process.exit(0);
          break;

        default: {
          // Treat unknown first token as a run target
          const flags = parseRunArgs(tokens);
          const configFile = readConfig(entryDir);
          const resolved = resolveRunOptions(
            flags,
            configFile.defaults,
            process.env,
            configFile.core,
          );
          currentAbort = new AbortController();
          try {
            await runCommand(resolved, registry, currentAbort.signal);
          } finally {
            currentAbort = null;
          }
          break;
        }
      }
    } catch (err) {
      console.error(red(`  Error: ${(err as Error).message}`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(dim("\n  Goodbye.\n"));
    process.exit(0);
  });
}
