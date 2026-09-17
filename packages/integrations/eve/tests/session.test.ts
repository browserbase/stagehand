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
    expect(cleanup.mock.calls[0]?.[0]).toBe(first);
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
    expect(cleanup.mock.calls[0]?.[0]).toBe(first);
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
  it("releases the remote session when client and browser close both hang", async () => {
    vi.useFakeTimers();
    const resources = createResources();
    resources.releaseSession = vi.fn(async () => undefined);
    vi.mocked(resources.stagehand.close).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(resources.browser.close).mockImplementation(() => new Promise(() => undefined));
    const closing = closeStagehandResources(resources, 25);

    await vi.advanceTimersByTimeAsync(25);
    await expect(closing).resolves.toBeUndefined();
    expect(resources.releaseSession).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait for a hung client before falling back from a failed browser close", async () => {
    vi.useFakeTimers();
    const resources = createResources();
    resources.releaseSession = vi.fn(async () => undefined);
    vi.mocked(resources.stagehand.close).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(resources.browser.close).mockRejectedValueOnce(new Error("transport lost"));
    const closing = closeStagehandResources(resources, 25);

    await vi.advanceTimersByTimeAsync(0);
    expect(resources.releaseSession).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25);
    await expect(closing).resolves.toBeUndefined();
  });

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
  it("sanitizes launch failures without attaching the provider error", async () => {
    const factory = createStagehandResourceFactory(async () => {
      throw new Error("provider rejected Bearer secret-provider-value");
    });
    const error = await factory().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StagehandSessionInitializationError);
    expect(error).toMatchObject({ message: "Failed to initialize the Stagehand browser session." });
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain("secret-provider-value");
  });

  it("sanitizes initialization failure after successful browser cleanup", async () => {
    const resources = createResources();
    const factory = createStagehandResourceFactory(
      async () => ({ browser: resources.browser }),
      async () => {
        throw new Error("provider rejected Bearer secret-provider-value");
      },
    );
    const error = await factory().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StagehandSessionInitializationError);
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain("secret-provider-value");
    expect(resources.browser.closed).toBe(true);
  });

  it("uses remote release after browser close hangs during failed initialization", async () => {
    vi.useFakeTimers();
    const resources = createResources();
    const releaseSession = vi.fn(async () => undefined);
    vi.mocked(resources.browser.close).mockImplementation(() => new Promise(() => undefined));
    const factory = createStagehandResourceFactory(
      async () => ({ browser: resources.browser, releaseSession }),
      async () => {
        throw new Error("initialization failed");
      },
    );
    const failed = expect(factory()).rejects.toBeInstanceOf(StagehandSessionInitializationError);
    await vi.advanceTimersByTimeAsync(5_000);
    await failed;
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it("awaits an in-flight fallback release before launching replacement resources", async () => {
    vi.useFakeTimers();
    const first = createResources();
    const second = createResources();
    const release = deferred<void>();
    const releaseSession = vi.fn(() => release.promise);
    vi.mocked(first.browser.close).mockImplementation(() => new Promise(() => undefined));
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ browser: first.browser, releaseSession })
      .mockResolvedValueOnce({ browser: second.browser });
    const createStagehand = vi
      .fn()
      .mockResolvedValueOnce(first.stagehand)
      .mockResolvedValueOnce(second.stagehand);
    const session = new StagehandSession(
      createStagehandResourceFactory(launch, createStagehand),
      closeStagehandResources,
      { cleanupTimeoutMs: 50 },
    );
    const failedClose = expect(session.run(({ tools }) => tools.close())).rejects.toThrow(
      "Failed to close the Stagehand browser session.",
    );
    await vi.advanceTimersByTimeAsync(50);
    await failedClose;
    expect(releaseSession).toHaveBeenCalledOnce();
    const next = session.run(async ({ browser }) => browser === second.browser);
    await vi.advanceTimersByTimeAsync(0);
    expect(launch).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledOnce();
    release.resolve();
    await expect(next).resolves.toBe(true);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("closes through the facade hook and starts the next tool with fresh resources", async () => {
    const first = createResources();
    const second = createResources();
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ browser: first.browser })
      .mockResolvedValueOnce({ browser: second.browser });
    const createStagehand = vi
      .fn()
      .mockResolvedValueOnce(first.stagehand)
      .mockResolvedValueOnce(second.stagehand);
    const session = new StagehandSession(createStagehandResourceFactory(launch, createStagehand));

    await session.run(({ tools }) => tools.close());
    expect(first.browser.close).toHaveBeenCalledOnce();
    await expect(session.run(async ({ browser }) => browser === second.browser)).resolves.toBe(
      true,
    );
    expect(launch).toHaveBeenCalledTimes(2);
    await session.run(({ tools }) => tools.close());
    expect(second.browser.close).toHaveBeenCalledOnce();
  });

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

    await expect(factory()).rejects.toBeInstanceOf(StagehandSessionInitializationError);
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
