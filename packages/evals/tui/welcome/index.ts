/**
 * `evals welcome` — the animated first-run experience for the evals CLI.
 *
 * One flow, built on a real WebVoyager case (never the core tier):
 *   intro   — the Stagehand mark carves in → the statement → accuracy · speed
 *             · cost land big in their colors → top of the board → the EVALS
 *             mark assembles and stays as the header
 *   the run — three models run the same task in lanes; podium by
 *             accuracy · speed · cost
 *   inside  — "want to see how the winner got there?" → the agent narrates
 *             the winning run, chat-style, to the judge's verdict
 *   hand-off — a real `run b:webvoyager -l 3 --harness …` when a key + browser
 *             exist, otherwise `evals setup`
 *
 * Any key advances the intro, Esc skips ahead, Ctrl+C cancels without burning
 * the first-run marker. `EVALS_WELCOME_WIZARD=1` auto-runs it on the first
 * REPL launch. Off-TTY every screen degrades to static frames and never
 * prompts.
 */

import { c } from "../format.js";
import { EvalsError } from "../../errors.js";
import type { CommandContext } from "../commandTree.js";
import type { WelcomeRunContext, WizardOutcome } from "./types.js";

/** EVALS_WELCOME_WIZARD opt-in: "1" / "true" / "yes" (case-insensitive). */
export function welcomeEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function runWelcome(ctx: WelcomeRunContext): Promise<WizardOutcome> {
  const { runArena } = await import("./arena.js");
  return runArena(ctx);
}

export function printWelcomeHelp(): void {
  console.log(
    [
      "",
      `  ${c.bold}evals welcome${c.reset}`,
      "",
      `  ${c.dim}Guided onboarding on a real WebVoyager task: the intro, three models${c.reset}`,
      `  ${c.dim}running the same task, a podium by accuracy · speed · cost, a look inside${c.reset}`,
      `  ${c.dim}the winning run, then a real run to try (or${c.reset} ${c.bb}evals setup${c.reset}${c.dim}).${c.reset}`,
      "",
      `  ${c.dim}Any key advances the intro · Esc skips ahead · Ctrl+C cancels${c.reset}`,
      `  ${c.dim}First-run auto-launch:${c.reset} ${c.bb}EVALS_WELCOME_WIZARD=1 evals${c.reset}`,
      "",
    ].join("\n"),
  );
}

/**
 * Command-tree handler. Owns stdin for the duration (see
 * CommandContext.suspendInput), then routes the hand-off: argv dispatches
 * the recommended command through the tree in both argv and REPL modes.
 */
export async function handleWelcome(args: string[], ctx: CommandContext): Promise<void> {
  const first = args[0]?.toLowerCase();
  if (first === "--help" || first === "-h" || first === "help") {
    printWelcomeHelp();
    return;
  }
  if (first !== undefined) {
    throw new EvalsError(
      `\`welcome\` takes no arguments (got "${args[0]}"). Try \`evals welcome --help\`.`,
    );
  }

  const restore = ctx.suspendInput?.() ?? (() => {});
  let outcome: WizardOutcome;
  try {
    outcome = await runWelcome({ entryDir: ctx.entryDir, getRegistry: ctx.getRegistry });
  } finally {
    restore();
  }

  if (outcome.status !== "completed" || !outcome.runNext) return;
  // "Enter to run it" means run it — in the REPL too. Pop any nested REPL
  // context first so the command resolves from the root of the tree.
  ctx.setContextPath?.([]);
  const { buildCommandTree, dispatch, tokenize } = await import("../commandTree.js");
  await dispatch(buildCommandTree(), tokenize(outcome.runNext), ctx);
}
