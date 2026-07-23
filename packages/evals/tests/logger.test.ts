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
});
