import { afterEach, describe, expect, it } from "vitest";
import { padRight, separator, stripAnsi } from "../../tui/format.js";

const originalColumns = process.stdout.columns;

afterEach(() => {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value: originalColumns,
  });
});

describe("tui format helpers", () => {
  it("truncates long cells with an ellipsis", () => {
    expect(padRight("abcdefghijklmnopqr", 8)).toBe("abcdefg…");
  });

  it("scales separators to the terminal width", () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 92,
    });

    expect(stripAnsi(separator())).toHaveLength(90);
  });
});
