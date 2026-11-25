import { c } from "../format.js";
import { EvalsError } from "../../errors.js";
import type { CommandContext } from "../commandTree.js";
import type { WelcomeRunContext, WizardOutcome } from "./types.js";

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
  ctx.setContextPath?.([]);
  const { buildCommandTree, dispatch, tokenize } = await import("../commandTree.js");
  await dispatch(buildCommandTree(), tokenize(outcome.runNext), ctx);
}
