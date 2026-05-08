/**
 * Interactive REPL for the evals CLI.
 *
 * Shares all parsing + dispatch with the single-shot argv path in
 * cli.ts via tui/commandTree.ts and tui/commands/*.
 */

import * as readline from "node:readline";
import { printBanner } from "./banner.js";
import { dim, red, yellow } from "./format.js";
import {
  buildCommandTree,
  dispatch,
  renderPrompt,
  tokenize,
  type CommandContext,
} from "./commandTree.js";
import { discoverTasks } from "../framework/discovery.js";
import type { TaskRegistry } from "../framework/types.js";
import { getRuntimeTasksRoot } from "../runtimePaths.js";

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

  const contextPath: string[] = [];
  const abortRef = { current: null as AbortController | null };

  const tree = buildCommandTree();

  const ctx: CommandContext = {
    entryDir,
    getRegistry: async () => registry,
    setRegistry: (r) => {
      registry = r;
    },
    abortRef,
    contextPath,
    pushContext: (seg) => {
      contextPath.push(seg);
    },
    popContext: () => {
      contextPath.pop();
    },
    setContextPath: (path) => {
      contextPath.length = 0;
      for (const p of path) contextPath.push(p);
    },
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: renderPrompt(contextPath),
  });

  // Esc → either pop one context level (idle) or abort the in-flight run
  // (cooperative; double-press escalates to aggressive — the runner closes
  // V3 sessions immediately so the in-flight task throws).
  let lastEscAt = 0;
  const DOUBLE_ESC_WINDOW_MS = 1500;

  const onKeypress = (
    _str: string,
    key: { name?: string; ctrl?: boolean } | undefined,
  ): void => {
    if (!key || key.name !== "escape") return;
    if (!abortRef.current) {
      // Idle Esc: pop one level if we're inside a context.
      if (contextPath.length > 0) {
        contextPath.pop();
        rl.setPrompt(renderPrompt(contextPath));
        process.stdout.write("\n");
        rl.prompt();
      }
      return;
    }
    const now = Date.now();
    const isDouble = now - lastEscAt < DOUBLE_ESC_WINDOW_MS;
    lastEscAt = now;
    if (isDouble) {
      console.log(red("\n  ✗ Aborting immediately…"));
      abortRef.current.abort("aggressive");
    } else {
      console.log(
        yellow(
          "\n  ⚠ Aborting after current task… (press Esc again to abort immediately)",
        ),
      );
      abortRef.current.abort("cooperative");
    }
  };
  process.stdin.on("keypress", onKeypress);

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.setPrompt(renderPrompt(contextPath));
      rl.prompt();
      return;
    }

    const tokens = tokenize(trimmed);

    try {
      await dispatch(tree, tokens, ctx);
    } catch (err) {
      console.error(red(`  Error: ${(err as Error).message}`));
    }

    rl.setPrompt(renderPrompt(contextPath));
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(dim("\n  Goodbye.\n"));
    process.exit(0);
  });
}
