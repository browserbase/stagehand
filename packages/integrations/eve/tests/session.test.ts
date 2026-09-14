import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeStagehandResources,
  createStagehandResourceFactory,
  StagehandSession,
  StagehandSessionCleanupError,
  StagehandSessionInitializationError,
  type StagehandResourceCleanup,
  type StagehandResources,
} from "../extension/lib/session.js";

afterEach(() => vi.useRealTimers());

describe("StagehandSession", () => {
  it("retries initialization after a rejected factory promise", async () => {
    const resources = createResources();
    const factory = vi
      .fn<() => Promise<StagehandResources>>()
      .mockRejectedValueOnce(new Error("temporary launch failure"))
      .mockResolvedValue(resources);
    const session = new StagehandSession(factory, vi.fn());

    await expect(session.run(async () => "unreachable")).rejects.toThrow(
      "temporary launch failure",
    );
    await expect(session.run(async () => "recovered")).resolves.toBe("recovered");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("serializes operations and continues after an operation error", async () => {
    const resources = createResources();
    const session = new StagehandSession(async () => resources, vi.fn());
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const events: string[] = [];

    const first = session.run(async () => {
      events.push("first:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      events.push("first:end");
    });
    const second = session.run(async () => {
      events.push("second");
      throw new Error("expected operation failure");
    });
    const third = session.run(async () => {
      events.push("third");
      return "done";
    });

    await firstStarted.promise;
    expect(events).toEqual(["first:start"]);
    releaseFirst.resolve();
    await first;
    await expect(second).rejects.toThrow("expected operation failure");
    await expect(third).resolves.toBe("done");
    expect(events).toEqual(["first:start", "first:end", "second", "third"]);
  });

  it("cleans up unhealthy resources before creating replacements", async () => {
    const first = createResources();
    const second = createResources();
    const factory = vi
      .fn<() => Promise<StagehandResources>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const cleanup = vi.fn<StagehandResourceCleanup>(async () => undefined);
    const session = new StagehandSession(factory, cleanup);

    await expect(
      session.run(async () => {
        markClosed(first);
        throw new Error("connection lost");
      }),
    ).rejects.toThrow("connection lost");
    await expect(session.run(async (resources) => resources === second)).resolves.toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(first);
  });

  it("bounds a hung operation and lets the queue continue with fresh resources", async () => {
    vi.useFakeTimers();
    const first = createResources();
    const second = createResources();
    const factory = vi
      .fn<() => Promise<StagehandResources>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const cleanup = vi.fn<StagehandResourceCleanup>(async () => undefined);
    const session = new StagehandSession(factory, cleanup, {
      operationTimeoutMs: 50,
      cleanupTimeoutMs: 50,
    });

    const hung = session.run(() => new Promise<never>(() => undefined));
    const next = session.run(async (resources) => resources === second);
    await vi.advanceTimersByTimeAsync(50);

    await expect(hung).rejects.toThrow("Stagehand operation timed out after 50ms.");
    await expect(next).resolves.toBe(true);
    expect(cleanup).toHaveBeenCalledWith(first);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("bounds cleanup after a timed-out operation", async () => {
    vi.useFakeTimers();
    const first = createResources();
    const second = createResources();
    const factory = vi
      .fn<() => Promise<StagehandResources>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const cleanup = vi.fn<StagehandResourceCleanup>(() => new Promise<void>(() => undefined));
    const session = new StagehandSession(factory, cleanup, {
      operationTimeoutMs: 25,
      cleanupTimeoutMs: 25,
    });

    const hung = session.run(() => new Promise<never>(() => undefined));
    const next = session.run(async (resources) => resources === second);
    await vi.advanceTimersByTimeAsync(50);

    await expect(hung).rejects.toThrow("Stagehand operation timed out after 25ms.");
    await expect(next).resolves.toBe(true);
  });
});

describe("closeStagehandResources", () => {
  it("does not report a Stagehand transport error after the browser closes", async () => {
    const resources = createResources();
    vi.mocked(resources.stagehand.close).mockRejectedValueOnce(new TypeError());

    await expect(closeStagehandResources(resources)).resolves.toBeUndefined();
    expect(resources.stagehand.close).toHaveBeenCalledOnce();
    expect(resources.browser.close).toHaveBeenCalledOnce();
  });

  it("surfaces a sanitized typed browser close failure", async () => {
    const resources = createResources();
    const browserCloseError = new Error("browser release failed");
    vi.mocked(resources.browser.close).mockRejectedValueOnce(browserCloseError);

    const error = await closeStagehandResources(resources).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(StagehandSessionCleanupError);
    expect(error).not.toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({
      name: "StagehandSessionCleanupError",
      message: "Failed to close the Stagehand browser session.",
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(error)).not.toContain(browserCloseError.message);
  });

  it("does not expose Stagehand or browser transport details", async () => {
    const resources = createResources();
    const stagehandCloseError = new TypeError("Stagehand transport failed");
    const browserCloseError = new Error("browser release failed");
    vi.mocked(resources.stagehand.close).mockRejectedValueOnce(stagehandCloseError);
    vi.mocked(resources.browser.close).mockRejectedValueOnce(browserCloseError);

    const error = await closeStagehandResources(resources).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(StagehandSessionCleanupError);
    expect(String(error)).not.toContain(stagehandCloseError.message);
    expect(String(error)).not.toContain(browserCloseError.message);
  });

  it("falls back to direct Browserbase release when browser close fails", async () => {
    const resources = createResources();
    const releaseSession = vi.fn(async () => undefined);
    resources.releaseSession = releaseSession;
    vi.mocked(resources.stagehand.close).mockRejectedValueOnce(new TypeError("transport closed"));
    vi.mocked(resources.browser.close).mockRejectedValueOnce(new Error("CDP close failed"));

    await expect(closeStagehandResources(resources)).resolves.toBeUndefined();
    expect(releaseSession).toHaveBeenCalledOnce();
  });
});

describe("createStagehandResourceFactory", () => {
  it("releases an owned session when initialization and browser close fail", async () => {
    const resources = createResources();
    const initializationError = new Error("Stagehand initialization failed");
    const releaseSession = vi.fn(async () => undefined);
    vi.mocked(resources.browser.close).mockRejectedValueOnce(new Error("CDP close failed"));
    const factory = createStagehandResourceFactory(
      async () => ({ browser: resources.browser, releaseSession }),
      async () => {
        throw initializationError;
      },
    );

    await expect(factory()).rejects.toBe(initializationError);
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it("retries a failed release before launching another browser", async () => {
    const first = createResources();
    const second = createResources();
    const releaseSession = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("release transport failed"))
      .mockResolvedValue(undefined);
    vi.mocked(first.browser.close).mockRejectedValueOnce(new Error("CDP close failed"));
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ browser: first.browser, releaseSession })
      .mockResolvedValueOnce({ browser: second.browser });
    const createStagehand = vi
      .fn()
      .mockRejectedValueOnce(new Error("initialization failed"))
      .mockResolvedValueOnce(second.stagehand);
    const factory = createStagehandResourceFactory(launch, createStagehand);

    await expect(factory()).rejects.toBeInstanceOf(StagehandSessionInitializationError);
    expect(launch).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledOnce();

    await expect(factory()).resolves.toMatchObject({
      browser: second.browser,
      stagehand: second.stagehand,
    });
    expect(releaseSession).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("retries a release from failed explicit cleanup before the next launch", async () => {
    const first = createResources();
    const second = createResources();
    const releaseSession = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("release transport failed"))
      .mockResolvedValue(undefined);
    vi.mocked(first.browser.close).mockRejectedValueOnce(new Error("CDP close failed"));
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ browser: first.browser, releaseSession })
      .mockResolvedValueOnce({ browser: second.browser });
    const createStagehand = vi
      .fn()
      .mockResolvedValueOnce(first.stagehand)
      .mockResolvedValueOnce(second.stagehand);
    const factory = createStagehandResourceFactory(launch, createStagehand);

    const firstResources = await factory();
    await expect(closeStagehandResources(firstResources)).rejects.toBeInstanceOf(
      StagehandSessionCleanupError,
    );
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledOnce();

    await expect(factory()).resolves.toMatchObject({ browser: second.browser });
    expect(releaseSession).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledTimes(2);
  });
});

function createResources(): StagehandResources {
  const browser = {
    closed: false,
    context: { pages: vi.fn(async () => [{}]) },
    close: vi.fn(async function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
  const resources = Object.create(null) as StagehandResources;
  return Object.assign(resources, {
    browser,
    stagehand: { close: vi.fn(async () => undefined) },
  });
}

function markClosed(resources: StagehandResources): void {
  Object.defineProperty(resources.browser, "closed", { value: true, configurable: true });
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
