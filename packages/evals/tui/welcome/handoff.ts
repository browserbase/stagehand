/**
 * The hand-off chip — the single primary call-to-action every welcome
 * variant ends on. Paints the recommended command in an accented panel,
 * breathes while waiting for Enter, drains a thin line toward the
 * auto-advance, and resolves to the command (Enter) or null (Esc/timeout).
 */

import { c, visibleLength } from "../format.js";
import {
  BRAND,
  canAnimateInPlace,
  center,
  LiveBlock,
  MINT,
  mix,
  panel,
  revealLines,
  rgb,
  ruleHeader,
  waitForKey,
  type SkipSignal,
} from "../wizardAnim.js";

/**
 * Show "Try this" + the chip for `rec` (argv suffix without `evals`).
 * Returns `rec` if the user pressed Enter, else null.
 */
export async function handoffChip(
  rec: string,
  signal: SkipSignal,
  opts: { title?: string; eyebrow?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  if (signal.cancelled) return null;
  ruleHeader(opts.title ?? "Try this", { eyebrow: opts.eyebrow ?? "next" });
  // The recommended command lives in an accented chip — the single primary
  // call-to-action of the whole wizard, so it gets the green border. While
  // it waits for Enter the border breathes and a thin line under the hint
  // drains toward the auto-advance, so the pause reads as alive, not stuck.
  const TIMEOUT_MS = opts.timeoutMs ?? 12_000;
  const cmd = `${c.bbBold}▸ evals ${rec}${c.reset}`;
  const inner = Math.max(visibleLength(cmd) + 6, 38);
  const chip = (border: string): string[] =>
    panel(["", center(cmd, inner), ""], {
      title: "run this",
      border,
      width: inner,
    });
  const hint = `  ${c.dim}Press${c.reset} ${c.bb}Enter${c.reset} ${c.dim}to run it now  ·  ${c.reset}${c.bb}Esc${c.reset} ${c.dim}to drop to the prompt${c.reset}`;
  const drainWidth = inner + 4;
  const drain = (frac: number): string =>
    `  ${c.gray}${"─".repeat(Math.round(Math.max(0, Math.min(1, frac)) * drainWidth))}${c.reset}`;

  await revealLines(chip(c.bb), { signal, perLineMs: 90 });
  process.stdout.write(`\n${hint}\n${drain(1)}\n`);

  let breathe: NodeJS.Timeout | null = null;
  if (canAnimateInPlace() && !signal.cancelled) {
    const block = new LiveBlock();
    block.adopt(chip(c.bb).length + 3);
    const started = Date.now();
    breathe = setInterval(() => {
      const t = Date.now() - started;
      const border = rgb(mix(BRAND, MINT, 0.5 + 0.5 * Math.sin(t / 420)));
      block.paint([...chip(border), "", hint, drain(1 - t / TIMEOUT_MS)]);
    }, 80);
  }
  const key = await waitForKey({ timeoutMs: TIMEOUT_MS, signal });
  if (breathe) {
    clearInterval(breathe);
    const block = new LiveBlock();
    block.adopt(chip(c.bb).length + 3);
    block.paint([...chip(c.bb), "", hint, ""]);
  }
  process.stdout.write("\n");
  if (key === "return") return rec;
  return null;
}
