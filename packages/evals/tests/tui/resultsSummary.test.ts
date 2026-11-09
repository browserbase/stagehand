import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printCellTable, printFailures } from "../../tui/results.js";
import { stripAnsi } from "../../tui/format.js";
import type { CellSummary, FailureRow } from "../../framework/runSummary.js";

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const savedColumns = process.stdout.columns;
beforeEach(() => {
  process.stdout.columns = 180;
});
afterEach(() => {
  logSpy.mockClear();
  process.stdout.columns = savedColumns;
});
const output = () => logSpy.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");

const cells: CellSummary[] = [
  {
    cell: "claude_code × stagehand_facade × anthropic/claude-sonnet-4-6",
    harness: "claude_code",
    toolSurface: "stagehand_facade",
    model: "anthropic/claude-sonnet-4-6",
    total: 46,
    passed: 33,
    maxTurns: 2,
    sdkError: 0,
    gated: 1,
    ungraded: 0,
    retried: 0,
    stopped: 0,
  },
  {
    cell: "codex × stagehand_facade × openai/gpt-5.4-mini",
    harness: "codex",
    toolSurface: "stagehand_facade",
    model: "openai/gpt-5.4-mini",
    total: 46,
    passed: 28,
    maxTurns: 5,
    sdkError: 3,
    gated: 0,
    ungraded: 0,
    retried: 2,
    stopped: 0,
  },
];

describe("printCellTable", () => {
  it("prints one row per cell, with only the count columns some cell uses", () => {
    printCellTable(cells);
    const text = output();
    // ungraded and stopped are 0 everywhere, so they're not columns.
    expect(text).toMatch(/cell\s+pass\s+max_turns\s+sdk_error\s+gated\s+retried$/m);
    expect(text).not.toContain("ungraded");
    expect(text).toMatch(
      /claude_code × stagehand_facade × anthropic\/claude-sonnet-4-6\s+72% 33\/46\s+2\s+0\s+1\s+0$/m,
    );
    expect(text).toMatch(
      /codex × stagehand_facade × openai\/gpt-5.4-mini\s+61% 28\/46\s+5\s+3\s+0\s+2$/m,
    );
  });

  it("leaves stopped rows out of the pass rate and shows them when there are any", () => {
    printCellTable([{ ...cells[0], total: 46, passed: 10, stopped: 26 }]);
    const text = output();
    expect(text).toMatch(/pass\s+max_turns\s+gated\s+stopped$/m);
    expect(text).toMatch(/50% 10\/20\s+2\s+1\s+26$/m);
  });

  it("stacks the cell name above its counts when the terminal is narrow", () => {
    process.stdout.columns = 80;
    printCellTable(cells.slice(0, 1));
    const lines = output().split("\n");
    expect(lines[1]).toBe("  claude_code × stagehand_facade × anthropic/claude-sonnet-4-6");
    expect(lines[2]).toMatch(/^\s+72% 33\/46\s+2\s+1$/);
  });

  it("prints nothing for an empty run", () => {
    printCellTable([]);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("printFailures", () => {
  const failures: FailureRow[] = [
    {
      kind: "sdk_error",
      harness: "codex",
      task: "9ab0c1d2 united.com",
      model: "openai/gpt-5.4-mini",
      reason: "rate_limit_exceeded (429)",
      sessionUrl: "https://www.browserbase.com/sessions/9ab0",
    },
    {
      kind: "max_turns",
      harness: "codex",
      task: "77d2e0b4 imgur.com",
      model: "openai/gpt-5.4-mini",
      reason: "50 turns, no final answer",
    },
    {
      kind: "gated",
      harness: "codex",
      task: "a004f2e1 apple.com",
      model: "openai/gpt-5.4-mini",
      reason: "no browser tool calls (judge passed; agent said: done)",
    },
    { kind: "fail", harness: "codex", task: "5c1d9e20 bbc.co.uk", model: "openai/gpt-5.4-mini" },
    { kind: "fail", harness: "codex", task: "3a77b1c2 gitlab.com", model: "openai/gpt-5.4-mini" },
  ];

  it("gives one-off failures a line with case, model, kind, reason and session", () => {
    printFailures(failures);
    const text = output();
    expect(text).toContain("Failures (5)");
    expect(text).toMatch(
      /✗ 9ab0c1d2 united\.com gpt-5\.4-mini\s+sdk_error\s+rate_limit_exceeded \(429\)\s+https:\/\/www\.browserbase\.com\/sessions\/9ab0/,
    );
    expect(text).toMatch(
      /⏱ 77d2e0b4 imgur\.com gpt-5\.4-mini\s+max_turns\s+50 turns, no final answer/,
    );
    expect(text).toMatch(/◐ a004f2e1 apple\.com gpt-5\.4-mini\s+gated\s+no browser tool calls/);
    // One harness: no harness column.
    expect(text).not.toMatch(/✗ codex/);
  });

  it("collapses failures that share a reason into one counted line, with their case ids", () => {
    printFailures(failures);
    expect(output()).toMatch(
      /✗ 2×\s+fail\s+task check failed \(no reason given\)\s+gpt-5\.4-mini · 5c1d9e20, 3a77b1c2$/m,
    );
  });

  it("points a shared credential failure at the doctor, largest group first", () => {
    const keyFailures: FailureRow[] = ["a", "b", "c"].map((id) => ({
      kind: "fail",
      harness: "stagehand",
      task: `act/${id}`,
      model: "anthropic/claude-haiku-4-5",
      reason: "invalid x-api-key",
    }));
    printFailures([failures[1], ...keyFailures]);
    const lines = output().split("\n");
    expect(lines[1]).toMatch(
      /✗ 3×\s+fail\s+invalid x-api-key\s+claude-haiku-4-5 .*→ check the key: evals doctor --probe/,
    );
    expect(lines[2]).toContain("77d2e0b4 imgur.com");
  });

  it("groups credential failures that tasks wrapped in their own words", () => {
    const wrapped: FailureRow[] = [
      "invalid x-api-key",
      "error attempting to select an option from the dropdown: invalid x-api-key",
      "self-heal did not expand the dropdown: invalid x-api-key",
    ].map((reason, index) => ({
      kind: "fail",
      harness: "stagehand",
      task: `act/${index}`,
      model: "anthropic/claude-haiku-4-5",
      reason,
    }));
    printFailures(wrapped);
    const lines = output().split("\n");
    expect(lines[1]).toMatch(/✗ 3×\s+fail\s+invalid x-api-key\s+claude-haiku-4-5/);
    expect(lines.filter((line) => line.includes("✗"))).toHaveLength(1);
  });

  it("keeps every line inside a narrow terminal, moving the hint down", () => {
    process.stdout.columns = 80;
    printFailures([
      ...["a", "b"].map((id): FailureRow => ({
        kind: "fail",
        harness: "stagehand",
        task: `act/${id}`,
        model: "anthropic/claude-haiku-4-5",
        reason: "invalid x-api-key",
      })),
    ]);
    const lines = logSpy.mock.calls.map(([line]) => stripAnsi(String(line)));
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
    expect(lines).toContain("      → check the key: evals doctor --probe");
  });

  it("leaves stopped rows to the caller", () => {
    printFailures([
      { kind: "stopped", harness: "stagehand", task: "act/x", model: "openai/gpt-4.1-mini" },
    ]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("caps the lines with a --json pointer and shows the harness when there are several", () => {
    printFailures(
      [
        ...failures.slice(0, 2),
        { ...failures[0], harness: "claude_code", task: "e81f4c0d amazon.com", reason: "other" },
      ],
      2,
    );
    const text = output();
    // Same-size groups go infra first: both sdk_errors, then the cap.
    expect(text).toMatch(/✗ codex 9ab0c1d2 united\.com/);
    expect(text).toMatch(/✗ claude_code e81f4c0d amazon\.com/);
    expect(text).toContain("… 1 more — --json has the full list");
    expect(text).not.toContain("imgur.com");
  });

  it("keeps a multi-line reason on one row and moves the URL down on a narrow terminal", () => {
    process.stdout.columns = 70;
    printFailures([
      {
        ...failures[0],
        reason: "stream closed\n    at Socket.onEnd (net.js:1)\n    at emit",
        sessionUrl: "https://www.browserbase.com/sessions/9ab0c1d2-5f6a-4b7c-8d9e-0123456789ab",
      },
    ]);
    const lines = logSpy.mock.calls.map(([line]) => stripAnsi(String(line)));
    const row = lines.find((line) => line.includes("9ab0c1d2 united.com"));
    expect(row).toMatch(/sdk_error\s+stream closed at So/);
    expect(row).not.toContain("https://");
    expect(lines).toContain(
      "      https://www.browserbase.com/sessions/9ab0c1d2-5f6a-4b7c-8d9e-0123456789ab",
    );
    // Everything but the URL line (a URL is never cut) fits the terminal.
    for (const line of lines.filter((line) => !line.includes("https://"))) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });

  it("prints nothing when there are no failures", () => {
    printFailures([]);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
