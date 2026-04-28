/**
 * ANSI color palette and formatters for the evals TUI.
 *
 * Modeled after the agents dev-cli format.ts — hand-rolled ANSI codes,
 * no external dependency needed.
 */

// ---------------------------------------------------------------------------
// ANSI escape helpers
// ---------------------------------------------------------------------------

const ESC_CHAR = String.fromCharCode(27);
const ESC = `${ESC_CHAR}[`;
const ANSI_PATTERN = new RegExp(`${ESC_CHAR}\\[[0-9;]*m`, "g");

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,

  // Evals brand green #01C851 (truecolor)
  bb: `${ESC}38;2;1;200;81m`,
  bbBold: `${ESC}1m${ESC}38;2;1;200;81m`,
} as const;

// ---------------------------------------------------------------------------
// Semantic helpers
// ---------------------------------------------------------------------------

export function bold(s: string): string {
  return `${c.bold}${s}${c.reset}`;
}

export function dim(s: string): string {
  return `${c.dim}${s}${c.reset}`;
}

export function red(s: string): string {
  return `${c.red}${s}${c.reset}`;
}

export function green(s: string): string {
  return `${c.green}${s}${c.reset}`;
}

export function yellow(s: string): string {
  return `${c.yellow}${s}${c.reset}`;
}

export function blue(s: string): string {
  return `${c.blue}${s}${c.reset}`;
}

export function cyan(s: string): string {
  return `${c.cyan}${s}${c.reset}`;
}

export function magenta(s: string): string {
  return `${c.magenta}${s}${c.reset}`;
}

export function gray(s: string): string {
  return `${c.gray}${s}${c.reset}`;
}

export function bb(s: string): string {
  return `${c.bb}${s}${c.reset}`;
}

export function bbBold(s: string): string {
  return `${c.bbBold}${s}${c.reset}`;
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "running" | "passed" | "failed" | "error";

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "◌",
  running: "●",
  passed: "✓",
  failed: "✗",
  error: "✗",
};

const STATUS_COLORS: Record<TaskStatus, (s: string) => string> = {
  pending: gray,
  running: blue,
  passed: green,
  failed: red,
  error: red,
};

export function statusBadge(status: TaskStatus): string {
  return STATUS_COLORS[status](`${STATUS_ICONS[status]} ${status}`);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function padRight(s: string, width: number): string {
  const fitted = truncateText(s, width);
  const padding = Math.max(0, width - visibleLength(fitted));
  return fitted + " ".repeat(padding);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function header(text: string): string {
  return `${c.bold}${c.underline}${text}${c.reset}`;
}

export function coolSilverHeader(text: string): string {
  return `${ESC}1m${ESC}38;2;224;229;236m${text}${c.reset}`;
}

export function warmStoneHeader(text: string): string {
  return `${ESC}1m${ESC}38;2;214;197;167m${text}${c.reset}`;
}

export function dustyCyanHeader(text: string): string {
  return `${ESC}1m${ESC}38;2;137;189;194m${text}${c.reset}`;
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, "");
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export function truncateText(s: string, width: number): string {
  if (width <= 0) return "";

  const plain = stripAnsi(s);
  if (plain.length <= width) {
    return plain;
  }

  if (width === 1) {
    return "…";
  }

  return `${plain.slice(0, width - 1).trimEnd()}…`;
}

export function getTerminalWidth(fallback = 100): number {
  const columns = process.stdout.columns;
  if (
    typeof columns !== "number" ||
    !Number.isFinite(columns) ||
    columns <= 0
  ) {
    return fallback;
  }
  return Math.max(60, columns);
}

export function separator(): string {
  return gray("─".repeat(Math.max(20, getTerminalWidth() - 2)));
}

export function writeRaw(s: string): void {
  process.stdout.write(s);
}

export function writeLine(s = ""): void {
  writeRaw(`${s}\n`);
}
