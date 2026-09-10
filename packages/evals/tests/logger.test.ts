import { afterEach, describe, expect, it, vi } from "vitest";
import { EvalLogger } from "../logger.js";

describe("EvalLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses console echo when constructed in quiet mode", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new EvalLogger(false);

    logger.log({
      category: "observation",
      message: "hidden",
      level: 1,
      timestamp: "2026-04-19T04:03:56.685Z",
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(logger.getLogs()).toHaveLength(1);
  });

  it("preserves console echo in verbose mode", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new EvalLogger(true);

    logger.log({
      category: "observation",
      message: "visible",
      level: 1,
      timestamp: "2026-04-19T04:03:56.685Z",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logger.getLogs()).toHaveLength(1);
  });

  it("keeps level-2 debug lines out of getLogs unless asked for", () => {
    const logger = new EvalLogger(false);
    logger.log({ category: "session", message: "session", level: 0 });
    logger.log({ category: "trace", message: "step", level: 1 });
    logger.log({ category: "trace", message: "unlevelled" });
    logger.log({ category: "mastra", message: "tool-call-delta event", level: 2 });

    expect(logger.getLogs().map((line) => line.message)).toEqual(["session", "step", "unlevelled"]);
    expect(logger.getLogs({ maxLevel: 2 })).toHaveLength(4);
    expect(logger.getLogs({ maxLevel: 0 }).map((line) => line.message)).toEqual(["session"]);
  });
});
