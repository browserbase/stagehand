import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureRecoveryError, TimeoutError } from "../errors.js";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";

describe("Page.pdf", () => {
  let page: Page;
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));

  beforeEach(() => {
    const logger = new StagehandLogger({ tracer: trace.getTracer("pdf-test") }, () => {});
    const connection = new CdpConnection(
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
    const session: CDPSessionLike = {
      send: send as CDPSessionLike["send"],
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn(async () => {}),
      id: "session-1",
    };
    page = new Page(connection, session, "page-1", "frame-1", logger);
    send.mockClear();
    send.mockResolvedValue({ data: "JVBERi0xLjcK" });
  });

  afterEach(() => {
    page.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders through Page.printToPDF and preserves base64 for transport", async () => {
    await expect(
      page.pdf({
        landscape: true,
        printBackground: true,
        paperWidth: 8.5,
        paperHeight: 11,
        marginTop: 0.25,
        timeout: 1_000,
      }),
    ).resolves.toStrictEqual({ data: "JVBERi0xLjcK" });
    expect(send).toHaveBeenCalledWith("Page.printToPDF", {
      landscape: true,
      printBackground: true,
      paperWidth: 8.5,
      paperHeight: 11,
      marginTop: 0.25,
      transferMode: "ReturnAsBase64",
    });
  });

  it("waits for screenshot style cleanup before printing", async () => {
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let notifyCleanup!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      notifyCleanup = resolve;
    });
    vi.spyOn(page, "frames").mockReturnValue([page.mainFrame()]);
    vi.spyOn(page.mainFrame(), "evaluate")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        notifyCleanup();
        await cleanup;
      });

    const screenshot = page.screenshot({ caret: "initial", style: "body { color: red; }" });
    await cleanupStarted;
    send.mockClear();
    const pdf = page.pdf();
    try {
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
    } finally {
      releaseCleanup();
      await screenshot;
    }
    await expect(pdf).resolves.toEqual({ data: "JVBERi0xLjcK" });
  });

  it("blocks screenshot setup while printing and releases the lock on failure", async () => {
    let rejectPrint!: (error: Error) => void;
    const print = new Promise<never>((_, reject) => {
      rejectPrint = reject;
    });
    send.mockImplementation(async (method) => {
      if (method === "Page.printToPDF") return await print;
      return { data: "JVBERi0xLjcK" };
    });
    vi.spyOn(page, "frames").mockReturnValue([page.mainFrame()]);
    const evaluate = vi.spyOn(page.mainFrame(), "evaluate").mockResolvedValue(undefined);
    const pdf = page.pdf();
    const printError = new Error("print failed");
    const failed = expect(pdf).rejects.toBe(printError);
    const screenshot = page.screenshot({ caret: "initial", style: "body { color: red; }" });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(send).toHaveBeenCalledWith("Page.printToPDF", { transferMode: "ReturnAsBase64" });
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      rejectPrint(printError);
      await failed;
    }
    await screenshot;
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("bounds stalled printing, isolates other pages, and recovers after the late response", async () => {
    vi.useFakeTimers();
    let finishPrinting!: (result: { data: string }) => void;
    const print = new Promise<{ data: string }>((resolve) => {
      finishPrinting = resolve;
    });
    send.mockImplementation(async (method) =>
      method === "Page.printToPDF" ? await print : { data: "AQ==" },
    );
    const otherPage = new Page(
      page.conn,
      {
        ...page.mainSession,
        id: "session-2",
        send: (async () => ({ data: "AQ==" })) as CDPSessionLike["send"],
      },
      "page-2",
      "frame-2",
      page.logger,
    );
    const pdf = page.pdf().catch((error: unknown) => error);
    const queued = page.pdf().catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await pdf;
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error).toMatchObject({ message: "pdf timed out after 30000ms" });
      const recoveryError = await queued;
      expect(recoveryError).toBeInstanceOf(CaptureRecoveryError);
      expect(recoveryError).toMatchObject({
        message: "A previous capture is still recovering: pdf timed out after 30000ms",
      });
      expect((recoveryError as Error).cause).toBe(error);
      await expect(page.pdf()).rejects.toBe(recoveryError);
      await expect(page.screenshot({ caret: "initial" })).rejects.toBe(recoveryError);
      await expect(otherPage.screenshot({ caret: "initial" })).resolves.toEqual(
        new Uint8Array([1]),
      );
      expect(send.mock.calls.filter(([method]) => method === "Page.printToPDF")).toHaveLength(1);

      finishPrinting({ data: "JVBERi0xLjcK" });
      await vi.advanceTimersByTimeAsync(0);
      await expect(page.pdf()).resolves.toEqual({ data: "JVBERi0xLjcK" });
      await expect(page.screenshot({ caret: "initial" })).resolves.toEqual(new Uint8Array([1]));
      expect(send.mock.calls.filter(([method]) => method === "Page.printToPDF")).toHaveLength(2);
      expect(await pdf).toBe(error);
    } finally {
      finishPrinting({ data: "JVBERi0xLjcK" });
      await vi.advanceTimersByTimeAsync(0);
      otherPage.dispose();
    }
  });

  it("expires queued printing without interrupting the active print or dispatching late work", async () => {
    vi.useFakeTimers();
    let finishPrinting!: (result: { data: string }) => void;
    const print = new Promise<{ data: string }>((resolve) => {
      finishPrinting = resolve;
    });
    send.mockReturnValue(print);
    let activeSettled = false;
    const active = page.pdf({ timeout: 0 }).finally(() => {
      activeSettled = true;
    });
    const queued = page.pdf({ timeout: 10 });
    const timedOut = expect(queued).rejects.toThrow("pdf timed out after 10ms");
    try {
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      expect(activeSettled).toBe(false);
      expect(send.mock.calls.filter(([method]) => method === "Page.printToPDF")).toHaveLength(1);
    } finally {
      finishPrinting({ data: "JVBERi0xLjcK" });
    }
    await expect(active).resolves.toEqual({ data: "JVBERi0xLjcK" });
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.filter(([method]) => method === "Page.printToPDF")).toHaveLength(1);
    await expect(page.pdf()).resolves.toEqual({ data: "JVBERi0xLjcK" });
    expect(send.mock.calls.filter(([method]) => method === "Page.printToPDF")).toHaveLength(2);
  });

  it("allows timeout zero to disable the print deadline", async () => {
    vi.useFakeTimers();
    let finishPrinting!: (result: { data: string }) => void;
    const print = new Promise<{ data: string }>((resolve) => {
      finishPrinting = resolve;
    });
    send.mockReturnValue(print);
    let settled = false;
    const pdf = page.pdf({ timeout: 0 }).finally(() => {
      settled = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      expect(send).toHaveBeenCalledWith("Page.printToPDF", { transferMode: "ReturnAsBase64" });
    } finally {
      finishPrinting({ data: "JVBERi0xLjcK" });
    }
    await expect(pdf).resolves.toEqual({ data: "JVBERi0xLjcK" });
  });
});
