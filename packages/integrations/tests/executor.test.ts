import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StagehandCodeConfig } from "../src/codemode/types.js";

const sdkMocks = vi.hoisted(() => ({
  browserbaseLaunch: vi.fn(),
  localLaunch: vi.fn(),
  stagehandCreate: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  browserbase: { launch: sdkMocks.browserbaseLaunch },
  localBrowser: { launch: sdkMocks.localLaunch },
  Stagehand: { create: sdkMocks.stagehandCreate },
}));

const { StagehandCodeExecutor } = await import("../src/codemode/executor.js");

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function localConfig(stagehand: Record<string, unknown> = {}): StagehandCodeConfig {
  return {
    browser: { type: "local", launchOptions: { headless: true } },
    stagehand: stagehand as never,
  };
}

function fakeRuntime() {
  const page = {
    url: vi.fn(async () => "https://example.com"),
    title: vi.fn(async () => "Example"),
    hold: vi.fn(async () => undefined),
    sideEffect: vi.fn(() => "side-effect"),
  };
  const context = {
    activePage: vi.fn(async () => page),
    pages: vi.fn(async () => [page]),
    newPage: vi.fn(async () => page),
  };
  const stagehand = {
    browser: { context },
    close: vi.fn(async () => undefined),
    metrics: vi.fn(async () => ({ act: { prompt_tokens: 1 } })),
  };
  const browser = { close: vi.fn(async () => undefined) };
  return { page, context, stagehand, browser };
}

describe("StagehandCodeExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates code before launching a browser", async () => {
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(executor.execute({ code: "   " })).resolves.toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    await expect(executor.execute({ code: "é".repeat(50_001) })).resolves.toMatchObject({
      ok: false,
      error: { kind: "validation", message: expect.stringContaining("100000 UTF-8 bytes") },
    });
    expect(sdkMocks.localLaunch).not.toHaveBeenCalled();
  });

  it("lazily launches once, reuses state, and closes both owners once", async () => {
    const runtime = fakeRuntime();
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(executor.execute({ code: "return 1;" })).resolves.toMatchObject({
      ok: true,
      value: 1,
      page: { url: "https://example.com", title: "Example" },
    });
    await expect(executor.execute({ code: "return 2;" })).resolves.toMatchObject({
      ok: true,
      value: 2,
    });

    expect(sdkMocks.localLaunch).toHaveBeenCalledOnce();
    expect(sdkMocks.localLaunch).toHaveBeenCalledWith({ headless: true });
    expect(sdkMocks.stagehandCreate).toHaveBeenCalledOnce();
    await executor.close();
    await executor.close();
    expect(runtime.stagehand.close).toHaveBeenCalledOnce();
    expect(runtime.browser.close).toHaveBeenCalledOnce();
  });

  it("forwards Browserbase launch options", async () => {
    const runtime = fakeRuntime();
    sdkMocks.browserbaseLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor({
      browser: {
        type: "browserbase",
        launchOptions: { apiKey: "bb_secret", projectId: "project-id" },
      },
    });

    await executor.execute({ code: "return 1;" });

    expect(sdkMocks.browserbaseLaunch).toHaveBeenCalledWith({
      apiKey: "bb_secret",
      projectId: "project-id",
    });
    expect(sdkMocks.localLaunch).not.toHaveBeenCalled();
  });

  it("serializes concurrent calls in FIFO order", async () => {
    const runtime = fakeRuntime();
    const gate = deferred<void>();
    runtime.page.hold.mockImplementationOnce(() => gate.promise);
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    const first = executor.execute({ code: 'await page.hold(); return "first";' });
    const second = executor.execute({ code: 'return "second";' });
    await vi.waitFor(() => expect(runtime.page.hold).toHaveBeenCalledOnce());
    expect(await Promise.race([second.then(() => "settled"), Promise.resolve("queued")])).toBe(
      "queued",
    );

    gate.resolve();

    await expect(first).resolves.toMatchObject({ ok: true, value: "first" });
    await expect(second).resolves.toMatchObject({ ok: true, value: "second" });
  });

  it("cancels queued work before its snippet begins", async () => {
    const runtime = fakeRuntime();
    const gate = deferred<void>();
    runtime.page.hold.mockImplementationOnce(() => gate.promise);
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());
    const controller = new AbortController();

    const first = executor.execute({ code: "await page.hold();" });
    const second = executor.execute({ code: "return page.sideEffect();" }, controller.signal);
    await vi.waitFor(() => expect(runtime.page.hold).toHaveBeenCalledOnce());
    controller.abort();
    gate.resolve();

    await first;
    await expect(second).resolves.toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(runtime.page.sideEffect).not.toHaveBeenCalled();
  });

  it("rechecks cancellation after lazy browser initialization", async () => {
    const runtime = fakeRuntime();
    const launch = deferred<typeof runtime.browser>();
    sdkMocks.localLaunch.mockReturnValue(launch.promise);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());
    const controller = new AbortController();

    const result = executor.execute({ code: "return page.sideEffect();" }, controller.signal);
    await vi.waitFor(() => expect(sdkMocks.localLaunch).toHaveBeenCalledOnce());
    controller.abort();
    launch.resolve(runtime.browser);

    await expect(result).resolves.toMatchObject({
      ok: false,
      page: { url: "https://example.com", title: "Example" },
      error: { kind: "aborted" },
    });
    expect(runtime.page.sideEffect).not.toHaveBeenCalled();
  });

  it("marks queued work closed and drains before cleanup", async () => {
    const runtime = fakeRuntime();
    const gate = deferred<void>();
    runtime.page.hold.mockImplementationOnce(() => gate.promise);
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    const active = executor.execute({ code: "await page.hold();" });
    const queued = executor.execute({ code: "return page.sideEffect();" });
    await vi.waitFor(() => expect(runtime.page.hold).toHaveBeenCalledOnce());
    const close = executor.close();
    gate.resolve();

    await active;
    await expect(queued).resolves.toMatchObject({ ok: false, error: { kind: "closed" } });
    await close;
    expect(runtime.page.sideEffect).not.toHaveBeenCalled();
    expect(runtime.stagehand.close).toHaveBeenCalledOnce();
    expect(runtime.browser.close).toHaveBeenCalledOnce();
    await expect(executor.execute({ code: "return 1;" })).resolves.toMatchObject({
      ok: false,
      error: { kind: "closed" },
    });
  });

  it("queues metrics behind execution", async () => {
    const runtime = fakeRuntime();
    const gate = deferred<void>();
    runtime.page.hold.mockImplementationOnce(() => gate.promise);
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    const active = executor.execute({ code: "await page.hold();" });
    const metrics = executor.metrics();
    await vi.waitFor(() => expect(runtime.page.hold).toHaveBeenCalledOnce());
    expect(runtime.stagehand.metrics).not.toHaveBeenCalled();
    gate.resolve();

    await active;
    await expect(metrics).resolves.toStrictEqual({ act: { prompt_tokens: 1 } });
  });

  it("closes a launched browser when Stagehand initialization fails", async () => {
    const runtime = fakeRuntime();
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockRejectedValue(new Error("initialization failed"));
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(executor.execute({ code: "return 1;" })).resolves.toMatchObject({
      ok: false,
      error: { kind: "runtime", message: "initialization failed" },
    });
    expect(runtime.browser.close).toHaveBeenCalledOnce();
  });

  it("reports a generic aggregate when initialization and cleanup both fail", async () => {
    const runtime = fakeRuntime();
    runtime.browser.close.mockRejectedValue(new Error("browser close secret"));
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockRejectedValue(new Error("init secret"));
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(executor.execute({ code: "return 1;" })).resolves.toMatchObject({
      ok: false,
      error: {
        kind: "runtime",
        name: "AggregateError",
        message: "Stagehand code mode initialization and browser cleanup both failed.",
      },
    });
  });

  it("normalizes JSON values and bounds returned output", async () => {
    const runtime = fakeRuntime();
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(
      executor.execute({ code: "return { big: 12n, bytes: new Uint8Array([1, 2, 3]) };" }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        big: "12",
        bytes: { type: "bytes", encoding: "base64", data: "AQID" },
      },
    });
    const large = await executor.execute({ code: 'return "x".repeat(300000);' });
    expect(large).toMatchObject({
      ok: true,
      value: { truncated: true, original_bytes: 300_002 },
    });
    if (large.ok && typeof large.value === "object" && large.value) {
      expect(
        Buffer.byteLength(String((large.value as { preview: string }).preview)),
      ).toBeLessThanOrEqual(256 * 1024);
    }
  });

  it("captures circular console values without changing snippet success", async () => {
    const runtime = fakeRuntime();
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(
      executor.execute({
        code: 'const circular = {}; circular.self = circular; console.log(circular); return "ok";',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: "ok",
      logs: [{ level: "log", text: "[Unserializable value]" }],
    });
  });

  it("redacts nested and shared secrets while preserving short ordinary text", async () => {
    const runtime = fakeRuntime();
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const shared = { value: "shared-secret-value" };
    const circular: Record<string, unknown> = { value: "circular-secret-value" };
    circular.self = circular;
    const executor = new StagehandCodeExecutor(
      localConfig({
        publicCopy: shared,
        tokens: { shared, circular },
        cookies: { nested: { value: "nested-secret-value" } },
        apiKey: "short",
      }),
    );

    const result = await executor.execute({
      code: `
        throw new Error(
          "shared-secret-value nested-secret-value circular-secret-value short ordinary " +
          "token=short Bearer bearer-value https://example.com/private"
        );
      `,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "runtime" } });
    if (result.ok === false) {
      expect(result.error.message).toContain("[REDACTED]");
      expect(result.error.message).toContain("short ordinary");
      expect(result.error.message).toContain("token=[REDACTED]");
      expect(result.error.message).toContain("Bearer [REDACTED]");
      expect(result.error.message).toContain("[REDACTED_URL]");
      expect(result.error.message).not.toContain("shared-secret-value");
      expect(result.error.message).not.toContain("nested-secret-value");
      expect(result.error.message).not.toContain("circular-secret-value");
      expect(result.error.message).not.toContain("bearer-value");
    }
  });

  it("normalizes non-Error throws and invalid error names", async () => {
    const runtime = fakeRuntime();
    sdkMocks.localLaunch.mockResolvedValue(runtime.browser);
    sdkMocks.stagehandCreate.mockResolvedValue(runtime.stagehand);
    const executor = new StagehandCodeExecutor(localConfig());

    await expect(executor.execute({ code: 'throw "raw secret";' })).resolves.toMatchObject({
      ok: false,
      error: { name: "Error", message: "Code execution failed with a non-Error value." },
    });
    await expect(
      executor.execute({
        code: 'const error = new Error("failed"); error.name = "bad name"; throw error;',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { name: "Error", message: "failed" },
    });
  });
});
