import { readFileSync } from "node:fs";
import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../../logger.js";
import { CdpConnection, type CDPSessionLike } from "../cdp.js";
import { Page } from "../page.js";
import { Progress } from "../progress.js";

const content = readFileSync(new URL("./fixtures/content.base64", import.meta.url), "utf8").trim();

describe("Page.captureAnnotatedPageContent", () => {
  let page: Page;
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));

  beforeEach(() => {
    const logger = new StagehandLogger({ tracer: trace.getTracer("apc-test") }, () => {});
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
    send.mockReset();
    send.mockResolvedValue({ content });
  });

  afterEach(() => {
    page.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("formats and filters APC under the page operation", async () => {
    await expect(page.apc({ actions: ["fill"] })).resolves.toBe(
      '[0-42] input_email [name="email"]',
    );
    await expect(page.apc({ actions: ["select"] })).resolves.toBe("");
    const full = await page.apc();
    expect(full).toContain('text: "Hello, 世界"');
    await expect(page.apc({ actions: [] })).resolves.toBe(full);
  });

  it.each([undefined, 25])("honors the APC capture timeout %s", async (timeout) => {
    vi.useFakeTimers();
    send.mockImplementationOnce(() => new Promise(() => {}));
    const failed = expect(page.apc({ timeout })).rejects.toThrow(
      `apc timed out after ${timeout ?? 20_000}ms`,
    );
    await vi.advanceTimersByTimeAsync(timeout ?? 20_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows unlimited capture when the APC timeout is zero", async () => {
    vi.useFakeTimers();
    send.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      return { content };
    });
    const pending = page.apc({ timeout: 0, actions: ["fill"] });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await pending).toContain("input_email");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares the remaining deadline between capture and tree processing", async () => {
    vi.useFakeTimers();
    const progress = new Progress("apc", 100);
    const captured = {
      get rootNode() {
        vi.advanceTimersByTime(31);
        return { contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_ROOT" as const } };
      },
    };
    const capture = vi
      .spyOn(page, "captureAnnotatedPageContent")
      .mockImplementation(async (parent) => {
        expect(parent).toBe(progress);
        await parent!.delay(70);
        return captured;
      });
    try {
      const failed = expect(page.apc({ timeout: 5_000 }, progress)).rejects.toThrow(
        "apc timed out after 100ms",
      );
      await vi.advanceTimersByTimeAsync(70);
      await failed;
      expect(capture).toHaveBeenCalledTimes(1);
    } finally {
      progress.dispose();
    }
  });

  it("requests actionable information and returns the decoded capture", async () => {
    const result = await page.captureAnnotatedPageContent();
    expect(result.rootNode?.childrenNodes).toHaveLength(2);
    expect(send).toHaveBeenCalledExactlyOnceWith("Page.getAnnotatedPageContent", {
      includeActionableInformation: true,
    });
  });

  it("propagates unsupported-command errors without falling back to a snapshot", async () => {
    const error = new Error("Page.getAnnotatedPageContent wasn't found");
    send.mockRejectedValueOnce(error);
    await expect(page.captureAnnotatedPageContent()).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed protobuf responses", async () => {
    send.mockResolvedValueOnce({ content: "EgU=" });
    await expect(page.captureAnnotatedPageContent()).rejects.toThrow();
  });

  it("stops waiting for a stalled capture at the default deadline", async () => {
    vi.useFakeTimers();
    send.mockImplementationOnce(() => new Promise(() => {}));
    const failed = expect(page.captureAnnotatedPageContent()).rejects.toThrow(
      /apc timed out after 20000ms/,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the remaining parent budget and ignores a late malformed response", async () => {
    vi.useFakeTimers();
    const progress = new Progress("act", 100);
    let respond!: (value: unknown) => void;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    try {
      await vi.advanceTimersByTimeAsync(70);
      const pending = page.captureAnnotatedPageContent(progress);
      const failed = expect(pending).rejects.toThrow(/act timed out after 100ms/);
      await vi.advanceTimersByTimeAsync(30);
      await failed;
      await expect(pending).rejects.toBe(progress.signal.reason);
      respond({ content: "not!base64" });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      progress.dispose();
    }
  });

  it("does not issue CDP commands with an expired parent", async () => {
    vi.useFakeTimers();
    const progress = new Progress("act", 10);
    try {
      await vi.advanceTimersByTimeAsync(10);
      await expect(page.captureAnnotatedPageContent(progress)).rejects.toBe(progress.signal.reason);
      expect(send).not.toHaveBeenCalled();
    } finally {
      progress.dispose();
    }
  });

  it("keeps an unlimited parent's budget and timer ownership", async () => {
    vi.useFakeTimers();
    const progress = new Progress("act", 0);
    send.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      return { content };
    });
    try {
      const pending = page.captureAnnotatedPageContent(progress);
      await vi.advanceTimersByTimeAsync(25_000);
      expect((await pending).rootNode?.childrenNodes).toHaveLength(2);
      expect(progress.remainingMs()).toBe(Infinity);
    } finally {
      progress.dispose();
    }
  });
});
