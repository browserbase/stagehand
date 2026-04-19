/**
 * Interactive REPL for the evals CLI.
 *
 * Shares all parsing + dispatch with the single-shot argv path in
 * cli.ts via tui/commands/parse.ts and tui/commands/*.
 */

import * as readline from "node:readline";
import { printBanner } from "./banner.js";
import { bb, dim, red } from "./format.js";
import {
  printHelp,
  printRunHelp,
  printListHelp,
  printNewHelp,
  printConfigHelp,
  printExperimentsHelp,
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
    console.error(
      red(`  Failed to discover tasks: ${(err as Error).message}`),
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${bb("evals")} ${dim(">")} `,
  });

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
    const wantsHelp = args.includes("--help") || args.includes("-h");

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
          await runCommand(resolved, registry);
          break;
        }

        case "list": {
          if (wantsHelp) {
            printListHelp();
            break;
          }
          const detailed =
            args.includes("--detailed") || args.includes("-d");
          const tierFilter = args.find((a) => !a.startsWith("-"));
          printList(registry, tierFilter, detailed);
          break;
        }

        case "config": {
          if (wantsHelp) {
            printConfigHelp();
            break;
          }
          await handleConfig(args, entryDir);
          break;
        }

        case "experiments": {
          if (wantsHelp && args.length === 0) {
            printExperimentsHelp();
            break;
          }
          await handleExperiments(args);
          break;
        }

        case "new":
          if (wantsHelp) {
            printNewHelp();
            break;
          }
          scaffoldTask(args);
          registry = await discoverTasks(resolvedTasksRoot, false);
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
          await runCommand(resolved, registry);
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
