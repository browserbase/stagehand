import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowLogWriter, resolveRunLogDir, rowLogFileName } from "../../framework/rowLog.js";
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
    ).toBe("47e314cc-recreation.gov__gpt-5.4-mini.log");
    expect(rowLogFileName({ name: "act/dropdown", model: "openai/gpt-4.1-mini", trial: 1 })).toBe(
      "act_dropdown-t2__gpt-4.1-mini.log",
    );
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
      },
    );
    expect(entries).toEqual([
      { category: "codex", message: "step 3", level: 1 },
      { category: "codex", message: "tool failed: timeout", level: 0 },
    ]);
    expect(log).not.toHaveBeenCalled();
    // Outside a row, echo works as before and the line is still recorded.
    logger.log({ category: "codex", message: "outside", level: 1 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(logger.getLogs().map((line) => line.message)).toEqual([
      "step 3",
      "tool failed",
      "outside",
    ]);
  });
});
