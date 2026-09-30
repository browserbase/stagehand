import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";
import { Locator } from "./locator.js";
import { Progress } from "./progress.js";

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

  it("includes mask lookup and paint waiting in the parent's screenshot budget", async () => {
    vi.useFakeTimers();
    const progress = new Progress("extract", 105);
    const locator = new Locator(page.mainFrame(), ".mask");
    const mask = page.deepLocator("iframe >> .mask");
    vi.spyOn(mask, "real").mockImplementation(async (received) => {
      expect(received).toBe(progress);
      await progress.delay(10);
      return locator;
    });
    const resolve = vi
      .spyOn(locator.selectorResolver, "resolveAll")
      .mockResolvedValue([{ objectId: "mask-node", nodeId: null }]);
    const evaluate = vi.spyOn(page.mainFrame(), "evaluate").mockResolvedValue(undefined);
    send.mockResolvedValue({ result: { value: { x: 1, y: 2, width: 3, height: 4 } } });
    const screenshot = page.screenshot({ mask: [mask], caret: "initial", timeout: 999 }, progress);
    const timedOut = expect(screenshot).rejects.toThrow("extract timed out after 105ms");
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(resolve).toHaveBeenCalledWith(expect.any(Object), {}, progress);
      expect(evaluate).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(95);
      await timedOut;
      await expect(screenshot).rejects.toBe(progress.signal.reason);
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "mask-node" });
      expect(send.mock.calls.some(([method]) => method === "Page.captureScreenshot")).toBe(false);
    } finally {
      progress.dispose();
    }
  });

  it("restores late mask measurements and releases skipped nodes before allowing printing", async () => {
    vi.useFakeTimers();
    const locator = new Locator(page.mainFrame(), ".mask");
    vi.spyOn(locator.selectorResolver, "resolveAll").mockResolvedValue([
      { objectId: "first", nodeId: null },
      { objectId: "second", nodeId: null },
    ]);
    let finishMeasurement!: (value: unknown) => void;
    const measurement = new Promise((resolve) => {
      finishMeasurement = resolve;
    });
    send.mockImplementation(async (method) =>
      method === "Runtime.callFunctionOn" ? measurement : { data: "AQ==" },
    );
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const evaluate = vi.spyOn(page.mainFrame(), "evaluate").mockReturnValue(cleanup);
    const screenshot = page.screenshot({ mask: [locator], caret: "initial", timeout: 10 });
    const timedOut = expect(screenshot).rejects.toThrow("screenshot timed out after 10ms");
    try {
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      expect(evaluate).not.toHaveBeenCalled();
      await expect(page.pdf()).rejects.toThrow(/still recovering/);
      finishMeasurement({
        result: { value: { x: 1, y: 2, width: 3, height: 4, rootToken: "root" } },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        send.mock.calls.filter(([method]) => method === "Runtime.callFunctionOn"),
      ).toHaveLength(1);
      for (const objectId of ["first", "second"]) {
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId });
      }
      expect(evaluate).toHaveBeenCalledTimes(1);
      await expect(page.pdf()).rejects.toThrow(/still recovering/);
      finishCleanup();
      await vi.advanceTimersByTimeAsync(0);
      await expect(page.pdf()).resolves.toEqual({ data: "AQ==" });
      expect(send.mock.calls.some(([method]) => method === "Page.captureScreenshot")).toBe(false);
    } finally {
      finishMeasurement({ result: { value: null } });
      finishCleanup();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("preserves a capture error when restoration stalls past the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(page, "frames").mockReturnValue([page.mainFrame()]);
    const failure = new Error("capture failed");
    send.mockImplementation(async (method) => {
      if (method === "Page.captureScreenshot") throw failure;
      return { data: "AQ==" };
    });
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    vi.spyOn(page.mainFrame(), "evaluate")
      .mockReturnValue(cleanup)
      .mockResolvedValueOnce(undefined);
    const screenshot = page.screenshot({ timeout: 10 });
    const failed = expect(screenshot).rejects.toBe(failure);
    try {
      await vi.advanceTimersByTimeAsync(10);
      await failed;
      await expect(page.pdf()).rejects.toThrow(/still recovering/);
      finishCleanup();
      await vi.advanceTimersByTimeAsync(0);
      await expect(page.pdf()).resolves.toEqual({ data: "AQ==" });
    } finally {
      finishCleanup();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("stops animation preparation at an expired deadline before its timer fires", async () => {
    vi.useFakeTimers();
    vi.spyOn(page, "frames").mockReturnValue([page.mainFrame()]);
    const evaluate = vi
      .spyOn(page.mainFrame(), "evaluate")
      .mockImplementationOnce(async () => {
        vi.spyOn(performance, "now").mockReturnValue(10);
      })
      .mockResolvedValue(undefined);
    await expect(page.screenshot({ animations: "disabled", timeout: 10 })).rejects.toThrow(
      "screenshot timed out after 10ms",
    );
    await vi.advanceTimersByTimeAsync(0);
    // One style insertion and its removal; no animation changes, caret setup, or capture.
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not inject styles after a late Runtime.enable response", async () => {
    vi.useFakeTimers();
    const frame = page.mainFrame();
    vi.spyOn(page, "frames").mockReturnValue([frame]);
    vi.spyOn(frame, "getMainWorldExecutionContextId").mockResolvedValue(1);
    let finishEnable!: () => void;
    const enable = new Promise<void>((resolve) => {
      finishEnable = resolve;
    });
    send
      .mockReturnValueOnce(enable)
      .mockResolvedValue({ result: { value: undefined }, data: "AQ==" });
    const screenshot = page.screenshot({ timeout: 10 });
    const timedOut = expect(screenshot).rejects.toThrow("screenshot timed out after 10ms");
    try {
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      await expect(page.pdf()).rejects.toThrow(/still recovering/);
      finishEnable();
      await vi.advanceTimersByTimeAsync(0);
      const evaluations = send.mock.calls.filter(([method]) => method === "Runtime.evaluate");
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0]?.[1]).toMatchObject({
        expression: expect.stringContaining("node.remove()"),
      });
      await expect(page.pdf()).resolves.toEqual({ data: "AQ==" });
    } finally {
      finishEnable();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("renders through Page.printToPDF and preserves base64 for transport", async () => {
    await expect(
      page.pdf({
        landscape: true,
        printBackground: true,
        width: 8.5,
        height: 11,
        margin: { top: 0.25, bottom: 0.5, left: 0.75, right: 1 },
        tagged: true,
        outline: true,
        timeout: 1_000,
      }),
    ).resolves.toStrictEqual({ data: "JVBERi0xLjcK" });
    expect(send).toHaveBeenCalledWith("Page.printToPDF", {
      landscape: true,
      printBackground: true,
      paperWidth: 8.5,
      paperHeight: 11,
      marginTop: 0.25,
      marginBottom: 0.5,
      marginLeft: 0.75,
      marginRight: 1,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
      transferMode: "ReturnAsBase64",
    });
  });

  it.each([undefined, {}, { margin: {} }, { margin: { top: 0 }, tagged: false, outline: false }])(
    "uses zero margins and disables tags and outlines by default (%j)",
    async (options) => {
      await page.pdf(options);
      expect(send.mock.calls).toStrictEqual([
        [
          "Page.printToPDF",
          {
            paperWidth: undefined,
            paperHeight: undefined,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            generateTaggedPDF: false,
            generateDocumentOutline: false,
            transferMode: "ReturnAsBase64",
          },
        ],
      ]);
    },
  );

  it("defaults only unspecified margin sides to zero", async () => {
    await page.pdf({ margin: { top: 0.5, right: 0.25 } });
    expect(send).toHaveBeenCalledWith(
      "Page.printToPDF",
      expect.objectContaining({
        marginTop: 0.5,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0.25,
      }),
    );
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

  it("keeps printing blocked until a timed-out screenshot finishes and restores styles", async () => {
    vi.useFakeTimers();
    let finishCapture!: (result: { data: string }) => void;
    const capture = new Promise<{ data: string }>((resolve) => {
      finishCapture = resolve;
    });
    send.mockImplementation(async (method) =>
      method === "Page.captureScreenshot" ? capture : { data: "AQ==" },
    );
    vi.spyOn(page, "frames").mockReturnValue([page.mainFrame()]);
    const evaluate = vi.spyOn(page.mainFrame(), "evaluate").mockResolvedValue(undefined);
    const screenshot = page.screenshot({
      timeout: 10,
      caret: "initial",
      style: "body { color: red; }",
    });
    const timedOut = expect(screenshot).rejects.toThrow(/screenshot.*timed out/i);
    try {
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      expect(evaluate).toHaveBeenCalledTimes(1);
      await expect(page.pdf()).rejects.toThrow(/still recovering/);
      expect(send.mock.calls.some(([method]) => method === "Page.printToPDF")).toBe(false);
      finishCapture({ data: "AQ==" });
      await vi.advanceTimersByTimeAsync(0);
      expect(evaluate).toHaveBeenCalledTimes(2);
      await expect(page.pdf()).resolves.toEqual({ data: "AQ==" });
    } finally {
      finishCapture({ data: "AQ==" });
      await vi.advanceTimersByTimeAsync(0);
    }
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
      expect(send).toHaveBeenCalledWith(
        "Page.printToPDF",
        expect.objectContaining({ transferMode: "ReturnAsBase64" }),
      );
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
    // Keep this request's own deadline later so it exercises queue recovery.
    const queued = page.pdf({ timeout: 60_000 }).catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await pdf;
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error).toMatchObject({ message: "pdf timed out after 30000ms" });
      const recoveryError = await queued;
      expect(recoveryError).toBeInstanceOf(Error);
      expect(recoveryError).toMatchObject({
        name: "Error",
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

  it("uses the time spent queueing as part of the print deadline", async () => {
    vi.useFakeTimers();
    let finishFirst!: (result: { data: string }) => void;
    let finishSecond!: (result: { data: string }) => void;
    send.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    send.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSecond = resolve;
      }),
    );
    const active = page.pdf({ timeout: 0 });
    const queued = page.pdf({ timeout: 20 });
    const timedOut = expect(queued).rejects.toThrow("pdf timed out after 20ms");
    try {
      await vi.advanceTimersByTimeAsync(10);
      finishFirst({ data: "AQ==" });
      await active;
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
    } finally {
      finishFirst({ data: "AQ==" });
      finishSecond({ data: "AQ==" });
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it.each(["pdf", "screenshot"] as const)(
    "%s inherits its parent's remaining budget",
    async (method) => {
      vi.useFakeTimers();
      const progress = new Progress("extract", 20);
      let finish!: (result: { data: string }) => void;
      const pending = new Promise<{ data: string }>((resolve) => {
        finish = resolve;
      });
      send.mockImplementation(async (command) =>
        command === "Page.printToPDF" || command === "Page.captureScreenshot" ? pending : {},
      );
      try {
        await vi.advanceTimersByTimeAsync(10);
        const capture =
          method === "pdf"
            ? page.pdf({ timeout: 0 }, progress)
            : page.screenshot({ timeout: 0, caret: "initial" }, progress);
        const timedOut = expect(capture).rejects.toThrow("extract timed out after 20ms");
        await vi.advanceTimersByTimeAsync(10);
        await timedOut;
        await expect(capture).rejects.toBe(progress.signal.reason);
      } finally {
        finish({ data: "AQ==" });
        await vi.advanceTimersByTimeAsync(0);
        progress.dispose();
      }
    },
  );

  it.each([
    { method: "pdf", timeout: 0 },
    { method: "screenshot", timeout: undefined },
    { method: "screenshot", timeout: 0 },
  ] as const)("keeps $method unlimited with timeout $timeout", async ({ method, timeout }) => {
    vi.useFakeTimers();
    let finish!: (result: { data: string }) => void;
    const pending = new Promise<{ data: string }>((resolve) => {
      finish = resolve;
    });
    const command = method === "pdf" ? "Page.printToPDF" : "Page.captureScreenshot";
    send.mockImplementation(async (method) => (method === command ? pending : {}));
    let settled = false;
    const capture = (
      method === "pdf" ? page.pdf({ timeout }) : page.screenshot({ timeout, caret: "initial" })
    ).finally(() => {
      settled = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      expect(send).toHaveBeenCalledWith(command, expect.any(Object));
    } finally {
      finish({ data: "AQ==" });
    }
    await expect(capture).resolves.toEqual(
      method === "pdf" ? { data: "AQ==" } : new Uint8Array([1]),
    );
  });
});
