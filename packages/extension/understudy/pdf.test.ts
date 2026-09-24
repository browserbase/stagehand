import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    const failed = expect(pdf).rejects.toThrow("print failed");
    const screenshot = page.screenshot({ caret: "initial", style: "body { color: red; }" });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(send).toHaveBeenCalledWith("Page.printToPDF", { transferMode: "ReturnAsBase64" });
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      rejectPrint(new Error("print failed"));
      await failed;
    }
    await screenshot;
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
