import { c, stripAnsi, visibleLength } from "./format.js";

export type SkipSignal = {
  cancelled: boolean;
  aborted: boolean;
};

export async function sleep(ms: number, signal?: SkipSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  const step = 40;
  for (let waited = 0; waited < ms && !signal.cancelled; waited += step) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, ms - waited)));
  }
}

export type RGB = readonly [number, number, number];

export const BRAND: RGB = [1, 200, 81];
export const MINT: RGB = [180, 255, 210];
const RULE_FADE: RGB = [70, 74, 80];

export function rgb(color: RGB): string {
  return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function gradientText(
  text: string,
  from: RGB,
  to: RGB,
  opts: {
    bold?: boolean;
    highlight?: { center: number; halfWidth: number };
  } = {},
): string {
  const chars = Array.from(text);
  const n = Math.max(1, chars.length - 1);
  let out = opts.bold ? c.bold : "";
  let last = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    let color = mix(from, to, i / n);
    if (opts.highlight) {
      const d = Math.abs(i - opts.highlight.center) / opts.highlight.halfWidth;
      if (d < 1) color = mix(color, MINT, (1 - d) * 0.9);
    }
    const code = rgb(color);
    if (code !== last) {
      out += code;
      last = code;
    }
    out += ch;
  }
  return out + c.reset;
}

export function wizardWidth(): number {
  const cols = process.stdout.columns ?? 72;
  return Math.max(48, Math.min(cols, 74));
}

export function canAnimateInPlace(): boolean {
  return Boolean(process.stdout.isTTY) && (process.stdout.columns ?? 0) >= 80;
}

export function center(text: string, width = wizardWidth()): string {
  const pad = Math.max(0, Math.floor((width - visibleLength(text)) / 2));
  return " ".repeat(pad) + text;
}

export function padTo(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

export function panel(
  content: string[],
  opts: {
    title?: string;
    footer?: string;
    indent?: number;
    padX?: number;
    border?: string;
    accent?: string;
    width?: number;
  } = {},
): string[] {
  const indent = " ".repeat(opts.indent ?? 2);
  const padX = opts.padX ?? 2;
  const border = opts.border ?? c.gray;
  const accent = opts.accent ?? c.bb;
  const r = c.reset;

  const titleW = opts.title ? visibleLength(opts.title) + 2 : 0;
  const footerW = opts.footer ? visibleLength(opts.footer) + 2 : 0;
  const natural = Math.max(titleW, footerW, ...content.map((l) => visibleLength(l)));
  const cap = wizardWidth() - indent.length - padX * 2 - 2;
  const inner = Math.max(8, Math.min(opts.width ?? natural, cap));
  const span = inner + padX * 2;

  const topBar = opts.title
    ? `${border}╭─${r}${accent}${c.bold} ${opts.title} ${r}${border}${"─".repeat(Math.max(1, span - visibleLength(opts.title) - 2 - 1))}╮${r}`
    : `${border}╭${"─".repeat(span)}╮${r}`;

  const bottomBar = opts.footer
    ? `${border}╰${"─".repeat(Math.max(1, span - visibleLength(opts.footer) - 2 - 1))}${r}${c.dim} ${opts.footer} ${r}${border}─╯${r}`
    : `${border}╰${"─".repeat(span)}╯${r}`;

  const body = content.map(
    (line) =>
      `${border}│${r}${" ".repeat(padX)}${padTo(line, inner)}${" ".repeat(padX)}${border}│${r}`,
  );

  return [topBar, ...body, bottomBar].map((row) => indent + row);
}

export const READING_MS_PER_WORD = 250;

function countWords(line: string): number {
  return stripAnsi(line)
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
}

type RevealOpts = {
  perLineMs?: number;
  msPerWord?: number;
  minLineMs?: number;
  maxLineMs?: number;
  signal?: SkipSignal;
};

function lineDelay(line: string, opts: RevealOpts): number {
  const { perLineMs = 60, msPerWord, minLineMs = 150, maxLineMs = 900 } = opts;
  return msPerWord
    ? Math.min(maxLineMs, Math.max(minLineMs, countWords(line) * msPerWord))
    : perLineMs;
}

export async function revealLines(lines: string[], opts: RevealOpts = {}): Promise<void> {
  const { signal } = opts;
  const animate = process.stdout.isTTY && !signal?.cancelled;
  for (const line of lines) {
    process.stdout.write(line + "\n");
    if (!animate || signal?.cancelled) continue;
    await sleep(lineDelay(line, opts), signal);
  }
}

export class LiveBlock {
  private rows = 0;

  adopt(rows: number): void {
    this.rows = rows;
  }

  paint(lines: string[], opts: { final?: boolean } = {}): void {
    if (!canAnimateInPlace()) {
      if (opts.final) {
        for (const line of lines) process.stdout.write(line + "\n");
      }
      return;
    }
    let out = this.rows > 0 ? `\x1b[${this.rows}A` : "";
    for (const line of lines) out += `\r\x1b[2K${line}\n`;
    process.stdout.write(out);
    this.rows = lines.length;
  }
}

export function setCursorHidden(hidden: boolean): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(hidden ? "\x1b[?25l" : "\x1b[?25h");
}

/**
 * Listen for skip/cancel keys. Esc flips `.cancelled` (fast-forward);
 * Ctrl+C flips `.aborted` as well (hard cancel). Call the returned
 * `release` fn to detach.
 *
 * Deliberately a raw `data` listener rather than readline keypress
 * events: Node's keypress decoder holds a lone Esc for an escape-sequence
 * timeout (~500ms) and its state can leak a phantom Esc into clack's own
 * keypress handling — which would insta-cancel the setup prompt that
 * follows. Raw bytes fire immediately and are fully consumed here.
 *
 * Intentionally a one-shot — animations check the flags each frame and
 * bail. Clack manages its own keypress handler so this listener should
 * only be active during the custom (non-clack) segments.
 */
export function listenForSkip(): { signal: SkipSignal; release: () => void } {
  const signal: SkipSignal = { cancelled: false, aborted: false };
  if (!process.stdin.isTTY) {
    return { signal, release: () => {} };
  }
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode?.(true);
  const onData = (chunk: Buffer): void => {
    for (const byte of chunk) {
      if (byte === 0x1b) {
        // Esc (also the prefix of arrow keys etc. — any of them skips)
        signal.cancelled = true;
      }
      if (byte === 0x03) {
        // Ctrl+C (raw mode disables the default SIGINT)
        signal.cancelled = true;
        signal.aborted = true;
      }
    }
  };
  process.stdin.on("data", onData);
  // An explicitly-paused stdin does NOT auto-resume when a 'data' listener
  // attaches (the argv entry point pauses it before handing over) — resume
  // by hand or the listener never hears a byte.
  process.stdin.resume();
  return {
    signal,
    release: () => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      process.stdin.setRawMode?.(Boolean(wasRaw));
    },
  };
}

export function ruleHeader(title: string, opts: { eyebrow?: string } = {}): void {
  const width = wizardWidth();
  process.stdout.write("\n");
  if (opts.eyebrow) {
    process.stdout.write(`  ${c.bbBold}${opts.eyebrow.toUpperCase()}${c.reset}\n`);
  }
  const dashes = Math.max(2, width - visibleLength(title) - 6);
  const rule = gradientText("─".repeat(dashes), BRAND, RULE_FADE);
  process.stdout.write(`  ${c.bb}━━${c.reset} ${c.bold}${title}${c.reset} ${rule}\n\n`);
}

export async function waitForKey(
  opts: { timeoutMs?: number; signal?: SkipSignal } = {},
): Promise<string | null> {
  const { timeoutMs = 8000, signal } = opts;
  if (!process.stdin.isTTY) return null;
  if (signal?.cancelled) return null;

  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode?.(true);

    let resolved = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.setRawMode?.(Boolean(wasRaw));
    };

    const settle = (value: string | null): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer): void => {
      let other = false;
      for (const byte of chunk) {
        if (byte === 0x0d || byte === 0x0a) return settle("return");
        if (byte === 0x1b || byte === 0x03) return settle("escape");
        other = true;
      }
      if (other) settle("other");
    };

    process.stdin.on("data", onData);
    process.stdin.resume();

    timer = setTimeout(() => settle(null), timeoutMs);
  });
}

export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "space"
  | "escape"
  | "ctrl-c"
  | "backspace"
  | "tab"
  | "char";
export type KeyEvent = { name: KeyName; char?: string };

function decodeKeys(chunk: Buffer): KeyEvent[] {
  const s = chunk.toString("utf8");
  const out: KeyEvent[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\x1b") {
      const seq = s.slice(i, i + 3);
      if (seq === "\x1b[A") out.push({ name: "up" });
      else if (seq === "\x1b[B") out.push({ name: "down" });
      else if (seq === "\x1b[C") out.push({ name: "right" });
      else if (seq === "\x1b[D") out.push({ name: "left" });
      else {
        out.push({ name: "escape" });
        i += 1;
        continue;
      }
      i += 3;
      continue;
    }
    if (ch === "\r" || ch === "\n") out.push({ name: "enter" });
    else if (ch === " ") out.push({ name: "space" });
    else if (ch === "\x03") out.push({ name: "ctrl-c" });
    else if (ch === "\x7f" || ch === "\b") out.push({ name: "backspace" });
    else if (ch === "\t") out.push({ name: "tab" });
    else out.push({ name: "char", char: ch });
    i += 1;
  }
  return out;
}

export function listenKeys(onKey: (key: KeyEvent) => void): { release: () => void } {
  if (!process.stdin.isTTY) return { release: () => {} };
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode?.(true);
  const onData = (chunk: Buffer): void => {
    for (const k of decodeKeys(chunk)) onKey(k);
  };
  process.stdin.on("data", onData);
  process.stdin.resume();
  return {
    release: () => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      process.stdin.setRawMode?.(Boolean(wasRaw));
    },
  };
}

export function termSize(): { rows: number; cols: number } {
  return { rows: process.stdout.rows ?? 24, cols: process.stdout.columns ?? 80 };
}
