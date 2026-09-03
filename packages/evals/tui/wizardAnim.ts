/**
 * Low-level animation primitives for the welcome wizard.
 *
 * Pure ANSI — no external deps. All helpers degrade gracefully when
 * stdout isn't a TTY (animations turn into instant prints of the final
 * frame), and in-place repaints additionally require a terminal wide
 * enough that no wizard line can wrap (wrapping breaks cursor-up math).
 *
 * Conventions:
 *   - Every animator accepts an optional `signal` whose `.cancelled`
 *     flag short-circuits to the final frame. The caller arms an Esc
 *     handler to flip it.
 *   - Cursor is hidden during animations and must be restored by the
 *     wrapping wizard via `setCursorHidden(false)` in a finally block.
 */

import { c, stripAnsi, visibleLength } from "./format.js";

/**
 * Two-level skip flag, checked each animation frame. A mutable flag (not
 * AbortController) on purpose: consumers poll it inside tight per-frame
 * loops that already wake every ≤40ms, so event-driven wakeup buys nothing,
 * and the two-level Esc/Ctrl+C semantics stay a plain object read.
 */
export type SkipSignal = {
  /** Esc — fast-forward: finish the current paint instantly, skip the rest of the intro. */
  cancelled: boolean;
  /** Ctrl+C — hard cancel: abandon the wizard entirely. Implies `cancelled`. */
  aborted: boolean;
};

/**
 * Sleep, optionally waking early when the skip signal flips — so Esc takes
 * effect within ~40ms instead of waiting out the current reveal beat.
 */
export async function sleep(ms: number, signal?: SkipSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  const step = 40;
  for (let waited = 0; waited < ms && !signal.cancelled; waited += step) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, ms - waited)));
  }
}

// ─── Color ──────────────────────────────────────────────────────────────

export type RGB = readonly [number, number, number];

/** Evals brand green — matches `c.bb` in format.ts. */
export const BRAND: RGB = [1, 200, 81];
/** Gradient partner: cool cyan. Green→cyan reads "electric" on dark themes. */
export const BRAND_2: RGB = [0, 190, 230];
/** Highlight tint for pulses / shimmer peaks. */
export const MINT: RGB = [180, 255, 210];
/** Where section rules fade out to. */
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

/**
 * Color a plain (ANSI-free) string with a horizontal gradient, optionally
 * lifting a band of characters toward MINT — the shimmer highlight.
 */
export function gradientText(
  text: string,
  from: RGB,
  to: RGB,
  opts: {
    bold?: boolean;
    /** Highlight band: visible-column center and half-width. */
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

// ─── Layout ─────────────────────────────────────────────────────────────

/** Usable render width — terminal columns capped to a comfortable measure. */
export function wizardWidth(): number {
  const cols = process.stdout.columns ?? 72;
  return Math.max(48, Math.min(cols, 74));
}

/**
 * In-place repaints (cursor-up + rewrite) only when we're on a TTY wide
 * enough that no wizard line wraps. Otherwise callers paint the final frame
 * once.
 */
export function canAnimateInPlace(): boolean {
  return Boolean(process.stdout.isTTY) && (process.stdout.columns ?? 0) >= 80;
}

/** Center a (possibly ANSI-colored) string within `width` columns. */
export function center(text: string, width = wizardWidth()): string {
  const pad = Math.max(0, Math.floor((width - visibleLength(text)) / 2));
  return " ".repeat(pad) + text;
}

/**
 * Right-pad an ANSI-colored string to a visible width. Not format.ts's
 * `padRight` on purpose: that one truncates via `truncateText`, which
 * strips ANSI codes — unusable for the wizard's colored strings.
 */
export function padTo(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

/**
 * Render a rounded, ANSI-aware box around `content` lines. Every helper that
 * draws a framed surface routes through here so corners, padding, and the
 * title/footer insets stay pixel-aligned regardless of embedded color codes.
 *
 * Returns the box as an array of indented lines (no trailing newline) so the
 * caller can paint it instantly, row-by-row via `revealLines`, or frame-by-
 * frame via `LiveBlock`.
 */
export function panel(
  content: string[],
  opts: {
    title?: string;
    footer?: string;
    indent?: number;
    padX?: number;
    /** Border color. Defaults to a soft gray; pass `c.bb` for an accented card. */
    border?: string;
    /** Title color. Defaults to brand green. */
    accent?: string;
    /** Fixed inner content width; defaults to the widest content line. */
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
  const span = inner + padX * 2; // chars between the two corner glyphs

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

// ─── Reveal cadences ────────────────────────────────────────────────────

/**
 * Average adult reading speed is ~240 wpm ≈ 250ms per word. Lines revealed
 * with `msPerWord: READING_MS_PER_WORD` land in lockstep with a reader —
 * each line's delay covers roughly the time it takes to read it, so text
 * never outruns the reader and the reader never waits on the machine.
 */
export const READING_MS_PER_WORD = 250;

/** Words a reader actually reads: tokens with alphanumerics (borders, bullets, arrows don't count). */
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

/**
 * Paint pre-formatted lines one row at a time. This is the backbone of the
 * wizard's "assembles in front of you" feel — every framed surface reveals
 * through here so the rhythm is identical across segments.
 *
 * Two cadences:
 *   - `perLineMs` (default): flat tick, for structural reveals the user
 *     scans as a shape (diagrams, panels, tables).
 *   - `msPerWord`: reading pace — delay scales with the line's word count,
 *     clamped to [minLineMs, maxLineMs], for prose and bullets the user
 *     actually reads as they appear.
 *
 * Honors the skip signal (instant) and degrades to plain prints off-TTY.
 */
export async function revealLines(lines: string[], opts: RevealOpts = {}): Promise<void> {
  const { signal } = opts;
  const animate = process.stdout.isTTY && !signal?.cancelled;
  for (const line of lines) {
    process.stdout.write(line + "\n");
    if (!animate || signal?.cancelled) continue;
    await sleep(lineDelay(line, opts), signal);
  }
}

/**
 * Like `revealLines`, but each line fades in: it lands as flat gray first,
 * then snaps to its real colors a beat later. Reading-paced by default.
 * Requires in-place repaint; otherwise identical to `revealLines`.
 */
export async function fadeInLines(
  lines: string[],
  opts: RevealOpts & { fadeMs?: number } = {},
): Promise<void> {
  const { signal, fadeMs = 110 } = opts;
  if (!canAnimateInPlace() || signal?.cancelled) {
    await revealLines(lines, opts);
    return;
  }
  for (const line of lines) {
    if (signal?.cancelled) {
      process.stdout.write(line + "\n");
      continue;
    }
    const plain = stripAnsi(line);
    process.stdout.write(`${c.gray}${plain}${c.reset}\n`);
    await sleep(fadeMs, signal);
    process.stdout.write(`\x1b[1A\r\x1b[2K${line}\n`);
    if (signal?.cancelled) continue;
    await sleep(Math.max(0, lineDelay(line, opts) - fadeMs), signal);
  }
}

/**
 * A block of lines that can be repainted in place. First `paint` prints the
 * block; later paints move the cursor up and rewrite every row. Heights
 * should stay constant between frames (shrinking leaves stale rows behind).
 *
 * Off-TTY / narrow terminals: `paint` prints only when `final` is true, so
 * frame loops become a single static print of the resting state.
 */
export class LiveBlock {
  private rows = 0;

  /** Take ownership of `rows` lines that were already printed (e.g. by `revealLines`). */
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

// ─── Input ──────────────────────────────────────────────────────────────

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

/**
 * Write text one character at a time. Honors the skip signal.
 */
export async function typewrite(
  text: string,
  opts: { msPerChar?: number; signal?: SkipSignal } = {},
): Promise<void> {
  const { msPerChar = 18, signal } = opts;
  if (!process.stdout.isTTY) {
    process.stdout.write(text);
    return;
  }
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (signal?.cancelled) {
      // Print the rest instantly and bail. Index-based on purpose:
      // indexOf(ch) would rewind to the first occurrence of a repeated
      // character and duplicate already-typed text.
      process.stdout.write(chars.slice(i).join(""));
      return;
    }
    process.stdout.write(ch);
    // Small sentences feel sluggish if every char is delayed equally;
    // give whitespace a shorter pause for a more natural rhythm.
    const delay = /\s/.test(ch) ? msPerChar / 2 : msPerChar;
    await sleep(delay);
  }
}

export async function typeline(
  text: string,
  opts: { msPerChar?: number; signal?: SkipSignal } = {},
): Promise<void> {
  await typewrite(text, opts);
  process.stdout.write("\n");
}

/**
 * Print a section heading. A small uppercase brand-green eyebrow (optional)
 * sits above a bold title, trailed by a rule that fades from brand green
 * out to the gutter. The eyebrow gives the wizard a magazine-like sense of
 * progression so the separate segments read as one guided flow.
 */
export function ruleHeader(title: string, opts: { eyebrow?: string } = {}): void {
  const width = wizardWidth();
  process.stdout.write("\n");
  if (opts.eyebrow) {
    process.stdout.write(`  ${c.bbBold}${opts.eyebrow.toUpperCase()}${c.reset}\n`);
  }
  // 2 indent + `━━ ` + title + ` ` + dashes must equal the measure.
  const dashes = Math.max(2, width - visibleLength(title) - 6);
  const rule = gradientText("─".repeat(dashes), BRAND, RULE_FADE);
  process.stdout.write(`  ${c.bb}━━${c.reset} ${c.bold}${title}${c.reset} ${rule}\n\n`);
}

/**
 * Wait for a key press, or for `timeoutMs`. Returns "return" for
 * Enter, "escape" for Esc, "other" for anything else, or null on
 * timeout / skip-signal.
 *
 * Same raw `data`-byte model as `listenForSkip` (see its rationale) —
 * one input discipline for the whole module, no keypress decoder ever
 * installed on stdin. Runs concurrently with an armed skip listener;
 * both see the same bytes, which is intended: Esc resolves here AND
 * flips the skip signal.
 *
 * Used to gate "press Enter to run it" without trapping users who
 * walked away — auto-advances after the timeout.
 */
export async function waitForKey(
  opts: { timeoutMs?: number; signal?: SkipSignal } = {},
): Promise<string | null> {
  const { timeoutMs = 8000, signal } = opts;
  if (!process.stdin.isTTY) return null;
  // A concurrent skip listener shares every byte with us (both are 'data'
  // listeners), so the only flip we could miss is one that happened before
  // we attached.
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
      const byte = chunk[0];
      if (byte === 0x0d || byte === 0x0a) return settle("return");
      if (byte === 0x1b) return settle("escape");
      if (byte === 0x03) return settle("escape"); // Ctrl+C — skip listener flips aborted
      settle("other");
    };

    process.stdin.on("data", onData);
    process.stdin.resume();

    timer = setTimeout(() => settle(null), timeoutMs);
  });
}

// ─── Decoded keys, alt screen ───────────────────────────────────────────

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

/**
 * Raw-mode key listener with sequence decoding (arrows, Enter, Space, Esc,
 * Ctrl+C, printable chars). Same raw `data` model as `listenForSkip` — never
 * installs readline's keypress decoder on stdin. Use this (not
 * `listenForSkip`) when a flow wants arrow keys: a lone Esc is still "escape".
 */
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

/** Wait for one decoded key (optionally only some), or null on timeout / off-TTY. */
export function waitKey(
  opts: { timeoutMs?: number; accept?: KeyName[] } = {},
): Promise<KeyEvent | null> {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: KeyEvent | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      listener.release();
      resolve(v);
    };
    const listener = listenKeys((k) => {
      if (opts.accept && !opts.accept.includes(k.name)) return;
      finish(k);
    });
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 30_000);
  });
}

export function termSize(): { rows: number; cols: number } {
  return { rows: process.stdout.rows ?? 24, cols: process.stdout.columns ?? 80 };
}

/** ANSI: absolute cursor move (1-based). */
export function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

/**
 * Alternate screen buffer (what vim/htop use): the flow paints a composed
 * full-screen frame and the user's scrollback is restored untouched on exit.
 * No-ops off-TTY. Always pair with `exitAltScreen` in a finally.
 */
export function enterAltScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?1049h" + CLEAR_SCREEN + "\x1b[?25l");
}
export function exitAltScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?25h\x1b[?1049l");
}

/** Paint a full-screen frame (array of rows) into the alt screen, top-left anchored. */
export function paintScreen(rows: string[]): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(rows.join("\n") + "\n");
    return;
  }
  let out = "\x1b[H";
  for (let i = 0; i < rows.length; i++) out += `\x1b[${i + 1};1H\x1b[2K${rows[i]}`;
  process.stdout.write(out);
}
