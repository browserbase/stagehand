import type { TurnRecord } from "./agent.ts";

/** Widths come from the content, so a long decision never wraps a column. */
function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column]!.length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column]!)))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
}

export function renderTurns(turns: readonly TurnRecord[]): string {
  return table(
    ["turn", "observe", "decide", "act", "jev", "seen", "done", "decision"],
    turns.map((turn) => [
      String(turn.index),
      `${turn.observeMs}ms`,
      `${turn.decideMs}ms`,
      turn.actMs > 0 ? `${turn.actMs}ms` : "-",
      `${turn.jevRequests}× ${turn.jevMs}ms`,
      String(turn.candidates),
      turn.doneScore === undefined ? "-" : turn.doneScore.toFixed(2),
      turn.decision,
    ]),
  );
}

export function totals(turns: readonly TurnRecord[]) {
  const sum = (pick: (turn: TurnRecord) => number) =>
    turns.reduce((at, turn) => at + pick(turn), 0);
  return {
    turns: turns.length,
    observeMs: sum((turn) => turn.observeMs),
    decideMs: sum((turn) => turn.decideMs),
    actMs: sum((turn) => turn.actMs),
    jevRequests: sum((turn) => turn.jevRequests),
    jevTokens: sum((turn) => turn.jevTokens),
    jevMs: sum((turn) => turn.jevMs),
  };
}
