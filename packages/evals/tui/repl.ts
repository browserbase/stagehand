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
import { printExtendedWelcome, printTipLine } from "./welcome.js";
import { snapshotEnv, renderInlineWarning } from "./welcomeStatus.js";
import { isFirstRun, markFirstRunComplete } from "./welcomeState.js";
import { variantFromEnv } from "./welcome/index.js";
import { abortActiveRun } from "../framework/activeRunCleanup.js";

export type ReplOptions = {
  /** Suppress banner, welcome, and any inline warnings. Output is just the prompt. */
  quiet?: boolean;
};

export async function startRepl(entryDir: string, options: ReplOptions = {}): Promise<void> {
  const quiet = options.quiet === true;
  const noWelcome = quiet || Boolean(process.env.EVALS_NO_WELCOME);

  const resolvedTasksRoot = getRuntimeTasksRoot();
  let registry: TaskRegistry;
  try {
    registry = await discoverTasks(resolvedTasksRoot, false);
  } catch (err) {
    console.error(red(`  Failed to discover tasks: ${(err as Error).message}`));
    process.exit(1);
  }

  // ─── Onboarding chrome ───────────────────────────────────────────────
  // First-run-only welcome panel; otherwise just the banner + tip line.
  // The only inline output about env state is the zero-keys warning,
  // surfaced when no welcome panel is shown. Discovery count is NOT
  // printed (use `list` or `evals doctor` instead).
  // Pre-filled into the readline buffer if a welcome flow recommends a
  // hand-off command. Set below, consumed after the interface exists.
  let pendingHandoff: string | null = null;

  if (!quiet) {
    const showExtendedWelcome = !noWelcome && isFirstRun(entryDir);
    const wizardVariant = variantFromEnv(process.env.EVALS_WELCOME_WIZARD);
    const wizardRan = showExtendedWelcome && wizardVariant !== null;

    if (wizardRan) {
      // Guided onboarding (opt-in via EVALS_WELCOME_WIZARD=<variant|1>).
      // Runs before readline exists, so it owns stdin outright. It paints
      // its own banner and marks first-run itself on completion — Ctrl+C
      // leaves the marker unset so it re-shows next launch.
      const { runWelcome } = await import("./welcome/index.js");
      const result = await runWelcome(wizardVariant, {
        entryDir,
        getRegistry: async () => registry,
      });
      if (result.status === "completed" && result.runNext) {
        pendingHandoff = result.runNext;
      } else if (result.status === "cancelled") {
        const warning = renderInlineWarning(snapshotEnv());
        if (warning && process.stdout.isTTY) console.log(warning);
        printTipLine();
      }
    } else {
      printBanner();
      if (showExtendedWelcome) {
        printExtendedWelcome({ snapshot: snapshotEnv(), registry });
      } else {
        const warning = renderInlineWarning(snapshotEnv());
        if (warning && process.stdout.isTTY) {
          console.log(warning);
        }
        printTipLine();
      }
    }
    console.log("");
    // Mark the marker pre-prompt so even an immediate Ctrl+C counts as
    // "first-run complete" — we don't want to re-prompt on every relaunch
    // when the user dismisses the welcome.
    //
    // Gated on `!quiet`: a `evals --quiet` invocation (often used by CI /
    // automation that pipes into the REPL) must NOT burn the first-run
    // marker, since the user never had a chance to see the welcome.
    // `EVALS_NO_WELCOME=1`, on the other hand, IS an explicit dismissal,
    // so it still marks the marker via the `else` branch above already
    // having rendered the tip line — the user knows they're in the REPL.
    // The wizard branch owns its own marking (see above).
    if (!wizardRan) {
      markFirstRunComplete(entryDir);
    }
  }

  const contextPath: string[] = [];
  const abortRef = { current: null as AbortController | null };

  const tree = buildCommandTree();

  let rlRef: readline.Interface | null = null;

  const ctx: CommandContext = {
    entryDir,
    getRegistry: async () => registry,
    setRegistry: (r) => {
      registry = r;
    },
    abortRef,
    contextPath,
    // Hand stdin to a welcome flow: detach every keypress listener (readline's
    // internal handler included — a paused interface still echoes keypresses
    // into rl.line once someone else resumes the stream) and pause the
    // interface so rl.resume() knows to restore flow after the flow's raw
    // listener leaves stdin paused.
    suspendInput: () => {
      const rl = rlRef;
      const listeners = process.stdin
        .rawListeners("keypress")
        .filter((l): l is (...a: unknown[]) => void => typeof l === "function");
      for (const l of listeners) process.stdin.off("keypress", l);
      rl?.pause();
      return () => {
        for (const l of listeners) process.stdin.on("keypress", l);
        rl?.resume();
      };
    },
    // Queued so the write lands after the current line handler returns and
    // the prompt has been re-rendered.
    prefillInput: (text) => {
      setImmediate(() => rlRef?.write(text));
    },
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
  rlRef = rl;

  // Esc → either pop one context level (idle) or abort the in-flight run
  // (cooperative; double-press escalates to aggressive — the runner closes
  // V3 sessions immediately so the in-flight task throws).
  let lastEscAt = 0;
  const DOUBLE_ESC_WINDOW_MS = 1500;

  const abortImmediately = (): void => {
    if (!abortRef.current) return;
    console.log(red("\n  ✗ Aborting immediately…"));
    void abortActiveRun(abortRef.current, "aggressive");
  };

  const onKeypress = (_str: string, key: { name?: string } | undefined): void => {
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
      abortImmediately();
    } else {
      console.log(
        yellow("\n  ⚠ Aborting after current task… (press Esc again to abort immediately)"),
      );
      void abortActiveRun(abortRef.current, "cooperative");
    }
  };
  process.stdin.on("keypress", onKeypress);

  // readline consumes Ctrl+C in raw terminal mode and emits SIGINT on the
  // interface instead of necessarily delivering it to process.on("SIGINT").
  rl.on("SIGINT", () => {
    if (abortRef.current) abortImmediately();
    else rl.close();
  });

  // A welcome hand-off lands in the buffer so the user just hits Enter.
  if (pendingHandoff) {
    rl.write(pendingHandoff);
  }
  rl.prompt(/* preserveCursor */ true);

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
    process.stdin.off("keypress", onKeypress);
    console.log(dim("\n  Goodbye.\n"));
    process.exit(0);
  });
}
