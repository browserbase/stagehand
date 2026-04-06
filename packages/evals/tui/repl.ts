/**
 * Interactive REPL for the evals CLI.
 *
 * Modeled after the agents dev-cli REPL: readline-based, command dispatch,
 * supports quoted strings for multi-word arguments.
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
} from "./commands/help.js";
import { printList } from "./commands/list.js";
import { printConfig } from "./commands/config.js";
import { runCommand } from "./commands/run.js";
import { scaffoldTask } from "./commands/new.js";
import { discoverTasks } from "../framework/discovery.js";
import type { TaskRegistry } from "../framework/types.js";
import path from "node:path";
import { getPackageRootDir } from "../runtimePaths.js";

/**
 * Tokenize a command string, respecting quoted strings.
 * "run agent "my prompt"" → ["run", "agent", "my prompt"]
 */
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

/**
 * Parse options from tokens.
 * Supports: -t 3, --trials 3, -e browserbase, --env local, -m model, -c 5
 */
function parseOptions(
  tokens: string[],
): { target?: string; trials?: number; concurrency?: number; env?: string; model?: string } {
  const result: Record<string, string | undefined> = {};
  let target: string | undefined;
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "-t" || tok === "--trials") {
      result.trials = tokens[++i];
    } else if (tok === "-c" || tok === "--concurrency") {
      result.concurrency = tokens[++i];
    } else if (tok === "-e" || tok === "--env") {
      result.env = tokens[++i];
    } else if (tok === "-m" || tok === "--model") {
      result.model = tokens[++i];
    } else if (!tok.startsWith("-")) {
      target = tok;
    }
    i++;
  }

  return {
    target,
    trials: result.trials ? parseInt(result.trials, 10) : undefined,
    concurrency: result.concurrency ? parseInt(result.concurrency, 10) : undefined,
    env: result.env,
    model: result.model,
  };
}

export async function startRepl(): Promise<void> {
  printBanner();

  // Always resolve from the package root, not the built dist directory
  const resolvedTasksRoot = path.join(getPackageRootDir(), "tasks");
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
          if (wantsHelp) { printRunHelp(); break; }
          const opts = parseOptions(args);
          const environment = opts.env?.toLowerCase() === "browserbase"
            ? "BROWSERBASE" as const
            : "LOCAL" as const;
          await runCommand(
            {
              target: opts.target,
              trials: opts.trials,
              concurrency: opts.concurrency,
              environment,
              model: opts.model,
            },
            registry,
          );
          break;
        }

        case "list": {
          if (wantsHelp) { printListHelp(); break; }
          const tierFilter = args[0];
          printList(registry, tierFilter);
          break;
        }

        case "config": {
          if (wantsHelp) { printConfigHelp(); break; }
          printConfig();
          break;
        }

        case "new":
          if (wantsHelp) { printNewHelp(); break; }
          scaffoldTask(args);
          // Re-discover after scaffold
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

        default:
          console.log(red(`  Unknown command: ${command}`) + dim("  Type 'help' for commands."));
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
