import { trace } from "@opentelemetry/api";
import { Page } from "./page.js";
import { CdpConnection } from "./cdp.js";
import { Frame } from "./frame.js";
import { StagehandLogger } from "../logger.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withScreenshotLock } from "./screenshotUtils.js";
import { Progress, runWithProgress } from "./progress.js";

function connection() {
  return { send: vi.fn(), on: vi.fn(), off: vi.fn(), close: vi.fn(), id: null };
}

function captureGate() {
  let release!: (value: Uint8Array) => void;
  const pending = new Promise<Uint8Array>((resolve) => {
    release = resolve;
  });
  return { pending, release: () => release(new Uint8Array([1])) };
}

describe("screenshot serialization", () => {
  const operations: Progress[] = [];
  const progress = (timeout = 0) => {
    const operation = new Progress("screenshot", timeout);
    operations.push(operation);
    return operation;
  };
  const runCapture = (owner: object, capture: () => Promise<Uint8Array>, operation: Progress) =>
    runWithProgress(operation, (progress) => withScreenshotLock(owner, capture, progress));

  afterEach(() => {
    for (const operation of operations.splice(0)) operation.dispose();
    vi.restoreAllMocks();
  });

  it("keeps another page's capture queued until the first finishes", async () => {
    const browser = connection();
    const first = captureGate();
    const nextCapture = vi.fn(async () => new Uint8Array([2]));
    const a = runCapture(browser, () => first.pending, progress());
    const b = runCapture(browser, nextCapture, progress());
    await Promise.resolve();
    expect(nextCapture).not.toHaveBeenCalled();
    first.release();
    await expect(a).resolves.toEqual(new Uint8Array([1]));
    await expect(b).resolves.toEqual(new Uint8Array([2]));
  });

  it("does not block a different browser", async () => {
    const first = captureGate();
    const a = runCapture(connection(), () => first.pending, progress());
    try {
      await expect(
        runCapture(connection(), async () => new Uint8Array([2]), progress()),
      ).resolves.toEqual(new Uint8Array([2]));
    } finally {
      first.release();
      await a;
    }
  });

  it("continues after a failed capture", async () => {
    const browser = connection();
    const a = runCapture(
      browser,
      async () => {
        throw new Error("capture failed");
      },
      progress(),
    );
    const b = runCapture(browser, async () => new Uint8Array([2]), progress());
    await expect(a).rejects.toThrow("capture failed");
    await expect(b).resolves.toEqual(new Uint8Array([2]));
  });

  it.each(["Page.enable", "Page.bringToFront", "Page.captureScreenshot"])(
    "keeps stalled %s locked through its late response and cleanup",
    async (stalledCommand) => {
      vi.useFakeTimers();
      const browser = connection();
      let respond!: (value: { data: string }) => void;
      const response = new Promise<{ data: string }>((resolve) => {
        respond = resolve;
      });
      browser.send.mockImplementation(async (method: string) =>
        method === stalledCommand ? response : {},
      );
      const frame = new Frame(
        browser,
        "frame",
        "page",
        false,
        new StagehandLogger({ tracer: trace.getTracer("screenshot-test") }, () => {}),
      );
      const cleanup = captureGate();
      const cleanupStarted = vi.fn();
      const operation = progress(10);
      const first = runCapture(
        browser,
        async () => {
          try {
            return await frame.screenshot({}, operation);
          } finally {
            cleanupStarted();
            await cleanup.pending;
          }
        },
        operation,
      );
      const nextCapture = vi.fn(async () => new Uint8Array([2]));
      const second = runCapture(browser, nextCapture, progress());
      const timedOut = expect(first).rejects.toThrow(/screenshot.*timed out/i);
      const blocked = expect(second).rejects.toThrow(/still recovering/);
      try {
        await vi.advanceTimersByTimeAsync(10);
        await timedOut;
        const commands = ["Page.enable", "Page.bringToFront", "Page.captureScreenshot"];
        const expectedCommands = commands.slice(0, commands.indexOf(stalledCommand) + 1);
        expect(browser.send.mock.calls.map(([method]) => method)).toEqual(expectedCommands);
        expect(cleanupStarted).not.toHaveBeenCalled();
        expect(nextCapture).not.toHaveBeenCalled();
        await blocked;
        await vi.advanceTimersByTimeAsync(0);
        await expect(runCapture(browser, nextCapture, progress())).rejects.toThrow(
          /still recovering/,
        );
        respond({ data: "AQ==" });
        await vi.advanceTimersByTimeAsync(0);
        expect(cleanupStarted).toHaveBeenCalledOnce();
        await expect(runCapture(browser, nextCapture, progress())).rejects.toThrow(
          /still recovering/,
        );
        cleanup.release();
        await vi.advanceTimersByTimeAsync(0);
        await expect(runCapture(browser, nextCapture, progress())).resolves.toEqual(
          new Uint8Array([2]),
        );
        respond({ data: "AQ==" });
        await vi.advanceTimersByTimeAsync(0);
        expect(cleanupStarted).toHaveBeenCalledOnce();
        expect(nextCapture).toHaveBeenCalledOnce();
        expect(browser.send.mock.calls.map(([method]) => method)).toEqual(expectedCommands);
      } finally {
        cleanup.release();
        respond({ data: "AQ==" });
        vi.useRealTimers();
      }
    },
  );

  it.each(["Page.enable", "Page.bringToFront", "Page.captureScreenshot"])(
    "checks the deadline after %s even before its timer fires",
    async (lastCommand) => {
      vi.useFakeTimers();
      const browser = connection();
      const frame = new Frame(
        browser,
        "frame",
        "page",
        false,
        new StagehandLogger({ tracer: trace.getTracer("screenshot-test") }, () => {}),
      );
      const operation = progress(10);
      browser.send.mockImplementation(async (method: string) => {
        if (method === lastCommand) vi.spyOn(performance, "now").mockReturnValue(10);
        return { data: "AQ==" };
      });
      try {
        await expect(
          runCapture(browser, () => frame.screenshot({}, operation), operation),
        ).rejects.toThrow(/screenshot.*timed out/i);
        const commands = ["Page.enable", "Page.bringToFront", "Page.captureScreenshot"];
        expect(browser.send.mock.calls.map(([method]) => method)).toEqual(
          commands.slice(0, commands.indexOf(lastCommand) + 1),
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(["setup", "cleanup"] as const)(
    "does not block another tab when page %s stalls",
    async (phase) => {
      vi.useFakeTimers();
      const logger = new StagehandLogger({ tracer: trace.getTracer("screenshot-test") }, () => {});
      const browser = new CdpConnection(
        {
          connected: true,
          send: vi.fn(),
          close: vi.fn(async () => {}),
          onMessage: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
        },
        logger,
      );
      const makePage = (id: string) => {
        const session = connection();
        session.send.mockResolvedValue({ data: "AQ==" });
        return new Page(browser, session, id, id, logger);
      };
      const firstPage = makePage("first");
      const otherPage = makePage("other");
      vi.spyOn(firstPage, "frames").mockReturnValue([firstPage.mainFrame()]);
      const stalled = captureGate();
      const evaluate = vi.spyOn(firstPage.mainFrame(), "evaluate").mockResolvedValue(undefined);
      if (phase === "cleanup") evaluate.mockResolvedValueOnce(undefined);
      evaluate.mockImplementationOnce(() => stalled.pending);
      const first = firstPage.screenshot({ timeout: 10 });
      const timedOut = expect(first).rejects.toThrow(/screenshot.*timed out/i);
      try {
        await vi.advanceTimersByTimeAsync(10);
        await timedOut;
        await expect(firstPage.screenshot({ caret: "initial" })).rejects.toThrow(
          /still recovering/,
        );
        let result: Uint8Array | undefined;
        let error: unknown;
        const other = otherPage.screenshot({ caret: "initial", timeout: 20 }).then(
          (value) => {
            result = value;
          },
          (reason: unknown) => {
            error = reason;
          },
        );
        await vi.advanceTimersByTimeAsync(20);
        await other;
        expect(error).toBeUndefined();
        expect(result).toEqual(new Uint8Array([1]));
        stalled.release();
        await vi.advanceTimersByTimeAsync(1);
        await expect(firstPage.screenshot({ caret: "initial" })).resolves.toEqual(
          new Uint8Array([1]),
        );
      } finally {
        stalled.release();
        await vi.advanceTimersByTimeAsync(0);
        firstPage.dispose();
        otherPage.dispose();
        vi.useRealTimers();
      }
    },
  );

  it.each(["timer", "clock"])("does not start expired queued work (%s)", async (expiry) => {
    vi.useFakeTimers();
    const browser = connection();
    const first = captureGate();
    const a = runCapture(browser, () => first.pending, progress());
    const nextCapture = vi.fn(async () => new Uint8Array([2]));
    const queuedProgress = progress(10);
    let leftQueue = false;
    const b = runWithProgress(queuedProgress, () =>
      withScreenshotLock(browser, nextCapture, queuedProgress).finally(() => {
        leftQueue = true;
      }),
    );
    const timedOut = expect(b).rejects.toThrow(/screenshot.*timed out/i);
    try {
      if (expiry === "timer") {
        await vi.advanceTimersByTimeAsync(10);
        await timedOut;
        expect(leftQueue).toBe(true);
        const laterCapture = vi.fn(async () => new Uint8Array([3]));
        const later = runCapture(browser, laterCapture, progress());
        await vi.advanceTimersByTimeAsync(0);
        expect(laterCapture).not.toHaveBeenCalled();
        first.release();
        await later;
      } else {
        // Advance the clock without delivering the deadline timer.
        vi.spyOn(performance, "now").mockReturnValue(10);
        expect(queuedProgress.signal.aborted).toBe(false);
      }
      first.release();
      await a;
      await timedOut;
      await runCapture(browser, async () => new Uint8Array([3]), progress());
      expect(nextCapture).not.toHaveBeenCalled();
    } finally {
      first.release();
      vi.useRealTimers();
    }
  });
});
