/**
 * `evals welcome [a|b|c]` — three onboarding designs, side by side.
 *
 *   a  Arena      — three models race the same real benchmark task in lanes
 *   b  Trace      — a recorded agent trajectory you scrub through (← → space)
 *   c  Dialogue   — the agent narrates a real task in first person, chat-style
 *
 * All three are built on agent benchmarks (the four external suites), never
 * the core tier. Each has a real-run hand-off when a key + browser exist and
 * an equally complete scripted path when they don't. Every design opens with
 * the shared intro (intro.ts): logo → statement → the three measures → top of
 * the board. `welcome` alone shows a picker; `EVALS_WELCOME_WIZARD=<variant|1>` auto-runs one on first launch.
 *
 * Shared: brand green, reading-paced copy, LiveBlock in-place animation, raw-
 * byte Esc (skip ahead) / Ctrl+C (cancel, no first-run marker), static frames
 * off-TTY, nothing wider than the terminal.
 */

import * as clack from "@clack/prompts";
import { c } from "../format.js";
import type { CommandContext } from "../commandTree.js";
import type { WelcomeRunContext, WizardOutcome } from "./types.js";

export type WelcomeVariant = "a" | "b" | "c";
export const WELCOME_VARIANTS: readonly WelcomeVariant[] = ["a", "b", "c"];
export const DEFAULT_VARIANT: WelcomeVariant = "a";

type VariantDef = {
  name: string;
  tagline: string;
  run: (ctx: WelcomeRunContext) => Promise<WizardOutcome>;
};

const VARIANTS: Record<WelcomeVariant, VariantDef> = {
  a: {
    name: "Arena",
    tagline: "three models race the same real benchmark task",
    run: async (ctx) => (await import("./arena.js")).runArena(ctx),
  },
  b: {
    name: "Trace",
    tagline: "scrub through a recorded agent trajectory",
    run: async (ctx) => (await import("./trace.js")).runTrace(ctx),
  },
  c: {
    name: "Dialogue",
    tagline: "the agent narrates a real task, chat-style",
    run: async (ctx) => (await import("./dialogue.js")).runDialogue(ctx),
  },
};

export function variantName(v: WelcomeVariant): string {
  return VARIANTS[v].name;
}

export function isWelcomeVariant(v: unknown): v is WelcomeVariant {
  return typeof v === "string" && (WELCOME_VARIANTS as readonly string[]).includes(v);
}

/** Resolve EVALS_WELCOME_WIZARD: "1"/"true" → default variant, a letter → that variant, else null. */
export function variantFromEnv(value: string | undefined): WelcomeVariant | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (isWelcomeVariant(v)) return v;
  if (v === "1" || v === "true" || v === "yes") return DEFAULT_VARIANT;
  return null;
}

async function pickVariant(): Promise<WelcomeVariant | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return DEFAULT_VARIANT;
  const choice = await clack.select({
    message: "Which onboarding do you want to try?",
    options: WELCOME_VARIANTS.map((v) => ({
      value: v,
      label: `${v}  ${VARIANTS[v].name}`,
      hint: VARIANTS[v].tagline,
    })),
    initialValue: DEFAULT_VARIANT,
  });
  if (clack.isCancel(choice) || !isWelcomeVariant(choice)) return null;
  return choice;
}

export async function runWelcome(
  variant: WelcomeVariant | undefined,
  ctx: WelcomeRunContext,
): Promise<WizardOutcome> {
  const chosen = variant ?? (await pickVariant());
  if (!chosen) return { status: "cancelled" };
  return VARIANTS[chosen].run(ctx);
}

export function printWelcomeHelp(): void {
  const lines = [
    "",
    `  ${c.bold}evals welcome${c.reset} ${c.dim}[variant]${c.reset}`,
    "",
    `  ${c.dim}Guided onboarding. Three designs to compare:${c.reset}`,
    "",
    ...WELCOME_VARIANTS.map(
      (v) =>
        `    ${c.bb}${v}${c.reset}  ${VARIANTS[v].name.padEnd(10)} ${c.dim}${VARIANTS[v].tagline}${c.reset}`,
    ),
    "",
    `    ${c.bb}intro${c.reset}  ${"".padEnd(10)} ${c.dim}the shared opening on its own (for iterating on the animation)${c.reset}`,
    "",
    `  ${c.dim}No variant → picker. Also:${c.reset} ${c.bb}welcome-a${c.reset}${c.dim} … ${c.reset}${c.bb}welcome-e${c.reset}`,
    `  ${c.dim}First-run auto-launch:${c.reset} ${c.bb}EVALS_WELCOME_WIZARD=a evals${c.reset}`,
    "",
  ];
  console.log(lines.join("\n"));
}

/**
 * Command-tree handler. Owns stdin for the duration (see
 * CommandContext.suspendInput), then routes the hand-off: argv dispatches
 * the recommended command through the tree; the REPL pre-fills it.
 */
export async function handleWelcome(args: string[], ctx: CommandContext): Promise<void> {
  const first = args[0]?.toLowerCase();
  if (first === "--help" || first === "-h" || first === "help") {
    printWelcomeHelp();
    return;
  }
  if (first === "intro") {
    // The shared opening on its own — for iterating on the animation without
    // sitting through a design. Owns stdin like the designs do; marks nothing.
    const restore = ctx.suspendInput?.() ?? (() => {});
    try {
      const { runIntro } = await import("./intro.js");
      await runIntro();
    } finally {
      restore();
      process.stdout.write("\x1b[?25h");
    }
    return;
  }
  let variant: WelcomeVariant | undefined;
  if (first !== undefined) {
    if (!isWelcomeVariant(first)) {
      throw new Error(
        `Unknown welcome variant "${first}". Use one of: ${WELCOME_VARIANTS.join(", ")}`,
      );
    }
    variant = first;
  }

  const restore = ctx.suspendInput?.() ?? (() => {});
  let outcome: WizardOutcome;
  try {
    outcome = await runWelcome(variant, {
      entryDir: ctx.entryDir,
      getRegistry: ctx.getRegistry,
    });
  } finally {
    restore();
  }

  if (outcome.status !== "completed" || !outcome.runNext) return;
  if (ctx.contextPath === null) {
    const { buildCommandTree, dispatch, tokenize } = await import("../commandTree.js");
    await dispatch(buildCommandTree(), tokenize(outcome.runNext), ctx);
  } else {
    ctx.prefillInput?.(outcome.runNext);
  }
}
