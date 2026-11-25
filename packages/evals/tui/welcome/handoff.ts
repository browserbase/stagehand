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

export async function handoffChip(
  rec: string,
  signal: SkipSignal,
  opts: { title?: string; eyebrow?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  if (signal.cancelled) return null;
  ruleHeader(opts.title ?? "Try this", { eyebrow: opts.eyebrow ?? "next" });
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("\n");
    return null;
  }
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
  const deadline = Date.now() + TIMEOUT_MS;
  let key: string | null = null;
  do {
    key = await waitForKey({ timeoutMs: Math.max(1, deadline - Date.now()), signal });
  } while (key === "other" && Date.now() < deadline && !signal.cancelled);
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
