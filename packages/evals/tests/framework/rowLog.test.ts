import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RowLogNames,
  RowLogWriter,
  resolveRunLogDir,
  rowLogFileName,
} from "../../framework/rowLog.js";
import { runInRowContext, type RowLogEntry } from "../../framework/rowContext.js";
import { EvalLogger } from "../../logger.js";

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-rowlog-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("rowLog", () => {
  it("names files by case, site, trial and model", () => {
    expect(
      rowLogFileName({ name: "47e314cc", domain: "recreation.gov", model: "openai/gpt-5.4-mini" }),
    ).toBe("47e314cc-recreation.gov__openai-gpt-5.4-mini.log");
    expect(rowLogFileName({ name: "act/dropdown", model: "openai/gpt-4.1-mini", trial: 1 })).toBe(
      "act_dropdown-t2__openai-gpt-4.1-mini.log",
    );
    // Same model id on two providers: two files.
    expect(rowLogFileName({ name: "a", model: "openai/foo" })).not.toBe(
      rowLogFileName({ name: "a", model: "anthropic/foo" }),
    );
  });

  it("gives colliding rows distinct names and the same row the same name", () => {
    const names = new RowLogNames();
    expect(names.claim("47e314cc__m.log", "suiteA|row")).toBe("47e314cc__m.log");
    expect(names.claim("47e314cc__m.log", "suiteB|row")).toBe("47e314cc__m~2.log");
    expect(names.claim("47e314cc__m.log", "suiteC|row")).toBe("47e314cc__m~3.log");
    expect(names.claim("47e314cc__m.log", "suiteB|row")).toBe("47e314cc__m~2.log");
    expect(names.claim("47e314cc__m.log", "suiteA|row")).toBe("47e314cc__m.log");
  });

  it("never throws when the log directory can't be created", async () => {
    const dir = tmp();
    const blocker = path.join(dir, "file");
    fs.writeFileSync(blocker, "");
    // A path under a regular file: mkdir fails with ENOTDIR.
    const writer = new RowLogWriter(path.join(blocker, "logs", "row.log"));
    expect(() => writer.write({ category: "codex", message: "x" })).not.toThrow();
    expect(() => writer.write({ category: "codex", message: "y" })).not.toThrow();
    expect(writer.hasContent).toBe(false);
    await writer.close();
  });

  it("puts logs beside persisted trajectories, else in a temp dir", () => {
    expect(
      resolveRunLogDir({ trajectoryRoot: "/r/.trajectories", trajectoryGroup: "g", persist: true }),
    ).toBe("/r/.trajectories/g/logs");
    expect(
      resolveRunLogDir({
        trajectoryRoot: "/r/.trajectories",
        trajectoryGroup: "g",
        persist: false,
      }),
    ).toBe(path.join(os.tmpdir(), "stagehand-evals", "g", "logs"));
  });

  it("writes lines with timestamp and category, marks retries, and creates nothing when silent", async () => {
    const dir = tmp();
    const silent = new RowLogWriter(path.join(dir, "silent.log"));
    await silent.close();
    expect(fs.existsSync(path.join(dir, "silent.log"))).toBe(false);
    expect(silent.hasContent).toBe(false);

    const writer = new RowLogWriter(path.join(dir, "nested", "row.log"));
    writer.attempt(1);
    writer.write(
      { category: "codex", message: "tool browser_navigate" },
      new Date("2026-09-29T14:02:11Z"),
    );
    writer.attempt(2);
    writer.write(
      { category: "console", message: "boom", level: 0 },
      new Date("2026-09-29T14:02:12Z"),
    );
    await writer.close();
    const text = fs.readFileSync(path.join(dir, "nested", "row.log"), "utf8");
    expect(text).toContain("2026-09-29T14:02:11.000Z [codex] tool browser_navigate\n");
    expect(text).toMatch(/\[runner\] ──── attempt 2 ────\n/);
    expect(text).toContain("2026-09-29T14:02:12.000Z [console] ERROR boom\n");
    expect(text).not.toContain("attempt 1");
  });

  it("EvalLogger routes into the row instead of echoing to the console", async () => {
    const entries: RowLogEntry[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new EvalLogger(true);
    await runInRowContext(
      { reportPhase: () => {}, log: (entry) => entries.push(entry) },
      async () => {
        logger.log({ category: "codex", message: "step 3", level: 1 });
        logger.error({
          category: "codex",
          message: "tool failed",
          level: 0,
          auxiliary: { error: { value: "timeout", type: "string" } },
        });
        logger.error({
          category: "bench",
          message: "Error in task x",
          auxiliary: {
            error: { value: "boom", type: "string" },
            trace: { value: "Error: boom\n    at task.ts:1", type: "string" },
          },
        });
      },
    );
    expect(entries).toEqual([
      { category: "codex", message: "step 3", level: 1 },
      { category: "codex", message: "tool failed: timeout", level: 0 },
      // No level given: error() still marks it as an error, and keeps the stack.
      {
        category: "bench",
        message: "Error in task x: boom\nError: boom\n    at task.ts:1",
        level: 0,
      },
    ]);
    expect(log).not.toHaveBeenCalled();
    // Outside a row, echo works as before and the line is still recorded.
    logger.log({ category: "codex", message: "outside", level: 1 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(logger.getLogs().map((line) => line.message)).toEqual([
      "step 3",
      "tool failed",
      "Error in task x",
      "outside",
    ]);
  });
});
