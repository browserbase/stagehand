/**
 * ANSI color palette and formatters for the evals TUI.
 *
 * Modeled after the agents dev-cli format.ts — hand-rolled ANSI codes,
 * no external dependency needed.
 */

// ---------------------------------------------------------------------------
// ANSI escape helpers
// ---------------------------------------------------------------------------

const ESC = "\x1b[";

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
  // Strip ANSI when measuring length
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return s + " ".repeat(padding);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function header(text: string): string {
  return `${c.bold}${c.underline}${text}${c.reset}`;
}

export function separator(): string {
  return gray("─".repeat(60));
}
