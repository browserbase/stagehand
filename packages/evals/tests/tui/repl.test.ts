import type readline from "node:readline";
import { describe, expect, it } from "vitest";
import { muteReadlineEcho } from "../../tui/repl.js";

describe("muteReadlineEcho", () => {
  it("swallows echo while muted, then restores it and clears the whole typed line", () => {
    const echoed: string[] = [];
    const writes: Array<{ ctrl?: boolean; name?: string }> = [];
    const original = (text: string) => echoed.push(text);
    const rl = {
      line: "",
      _writeToOutput: original,
      write: (_data: unknown, key: { ctrl?: boolean; name?: string }) => writes.push(key),
    };
    const unmute = muteReadlineEcho(rl as unknown as readline.Interface);
    rl._writeToOutput("v");
    expect(echoed).toEqual([]);

    rl.line = "vv?";
    unmute();
    expect(rl._writeToOutput).toBe(original);
    // End first, then Ctrl-U: clears both sides of wherever the cursor was.
    expect(writes).toEqual([
      { ctrl: true, name: "e" },
      { ctrl: true, name: "u" },
    ]);
  });

  it("leaves an empty line alone", () => {
    const writes: unknown[] = [];
    const rl = { line: "", _writeToOutput: () => {}, write: () => writes.push(1) };
    muteReadlineEcho(rl as unknown as readline.Interface)();
    expect(writes).toEqual([]);
  });
});
