import { describe, expect, it, vi } from "vitest";
import { cleanupV4CodeBrowserbaseResources } from "../../framework/v4CodeBrowserbaseCleanup.js";

function deferred<T>(): {
  promise: Promise<T>;
  reject: (error: Error) => void;
} {
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

function expectSessionCleanupTimeout(
  error: unknown,
  description: string,
): void {
  expect(error).toBeInstanceOf(AggregateError);
  const [cause] = (error as AggregateError).errors;
  expect(cause).toBeInstanceOf(Error);
  expect((cause as Error).message).toBe(
    `Browserbase session cleanup timed out after 5ms while ${description}.`,
  );
}

describe("V4 Browserbase fallback cleanup", () => {
  it("releases the session before deleting the uploaded extension", async () => {
    const calls: string[] = [];
    const createClient = vi.fn(() => ({
      releaseSession: vi.fn(async (sessionId: string, projectId?: string) => {
        calls.push(`release:${sessionId}:${projectId}`);
      }),
      retrieveSession: vi.fn(async () => ({ status: "COMPLETED" })),
      deleteExtension: vi.fn(async (extensionId: string) => {
        calls.push(`delete:${extensionId}`);
      }),
    }));

    await cleanupV4CodeBrowserbaseResources(
      {
        apiKey: "private-api-key",
        projectId: "private-project",
        resources: {
          sessionId: "session-resource",
          extensionId: "extension-resource",
        },
      },
      createClient,
    );

    expect(createClient).toHaveBeenCalledWith("private-api-key");
    expect(calls).toEqual([
      "release:session-resource:private-project",
      "delete:extension-resource",
    ]);
  });

  it("treats already-cleaned resources as benign and still attempts both", async () => {
    const deleteExtension = vi.fn(async () => {
      throw Object.assign(new Error("extension not found"), { status: 404 });
    });
    await expect(
      cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          resources: {
            sessionId: "session-resource",
            extensionId: "extension-resource",
          },
        },
        () => ({
          releaseSession: async () => {
            throw new Error("session already released");
          },
          retrieveSession: async () => ({ status: "COMPLETED" }),
          deleteExtension,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(deleteExtension).toHaveBeenCalledOnce();
  });

  it("aggregates non-benign errors after attempting both resources", async () => {
    const deleteExtension = vi.fn(async () => {
      throw new Error("extension API unavailable");
    });
    await expect(
      cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          resources: {
            sessionId: "session-resource",
            extensionId: "extension-resource",
          },
        },
        () => ({
          releaseSession: async () => {
            throw new Error("session API unavailable");
          },
          retrieveSession: async () => ({ status: "RUNNING" }),
          deleteExtension,
        }),
      ),
    ).rejects.toThrow(/Browserbase resource cleanup failed/i);
    expect(deleteExtension).toHaveBeenCalledOnce();
  });

  it("retries an acknowledged release until the session is terminal", async () => {
    let clock = 0;
    const releaseSession = vi.fn(async () => undefined);
    const retrieveSession = vi
      .fn<() => Promise<{ status: string }>>()
      .mockResolvedValueOnce({ status: "RUNNING" })
      .mockResolvedValueOnce({ status: "RUNNING" })
      .mockResolvedValueOnce({ status: "COMPLETED" });

    await expect(
      cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          projectId: "private-project",
          resources: { sessionId: "session-resource" },
        },
        () => ({
          releaseSession,
          retrieveSession,
          deleteExtension: async () => undefined,
        }),
        {
          sessionCleanupTimeoutMs: 10,
          sessionReleaseRetryAfterMs: 1,
          sessionStatusPollIntervalMs: 1,
          now: () => clock,
          sleep: async (delayMs) => {
            clock += delayMs;
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(releaseSession).toHaveBeenCalledTimes(2);
    expect(retrieveSession).toHaveBeenCalledTimes(3);
  });

  it("rejects cleanup when an acknowledged release never becomes terminal", async () => {
    let clock = 0;
    const releaseSession = vi.fn(async () => undefined);

    await expect(
      cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          resources: { sessionId: "session-resource" },
        },
        () => ({
          releaseSession,
          retrieveSession: async () => ({ status: "RUNNING" }),
          deleteExtension: async () => undefined,
        }),
        {
          sessionCleanupTimeoutMs: 3,
          sessionReleaseRetryAfterMs: 1,
          sessionStatusPollIntervalMs: 1,
          now: () => clock,
          sleep: async (delayMs) => {
            clock += delayMs;
          },
        },
      ),
    ).rejects.toThrow(/Browserbase resource cleanup failed/i);

    expect(releaseSession).toHaveBeenCalledTimes(2);
  });

  it("bounds the initial release request by the cleanup deadline", async () => {
    vi.useFakeTimers();
    try {
      const lateRelease = deferred<unknown>();
      const cleanup = cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          resources: { sessionId: "session-resource" },
        },
        () => ({
          releaseSession: () => lateRelease.promise,
          retrieveSession: async () => ({ status: "COMPLETED" }),
          deleteExtension: async () => undefined,
        }),
        { sessionCleanupTimeoutMs: 5 },
      );
      const observed = cleanup.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(5);

      expectSessionCleanupTimeout(
        await observed,
        "requesting the initial session release",
      );
      expect(vi.getTimerCount()).toBe(0);
      lateRelease.reject(new Error("late release rejection"));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds every status retrieval by the cleanup deadline", async () => {
    vi.useFakeTimers();
    try {
      const lateRetrieve = deferred<unknown>();
      const retrieveSession = vi.fn(() => lateRetrieve.promise);
      const cleanup = cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          resources: { sessionId: "session-resource" },
        },
        () => ({
          releaseSession: async () => undefined,
          retrieveSession,
          deleteExtension: async () => undefined,
        }),
        { sessionCleanupTimeoutMs: 5 },
      );
      const observed = cleanup.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(5);

      expect(retrieveSession).toHaveBeenCalledOnce();
      expectSessionCleanupTimeout(await observed, "retrieving session status");
      expect(vi.getTimerCount()).toBe(0);
      lateRetrieve.reject(new Error("late retrieve rejection"));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the fallback release by the remaining cleanup deadline", async () => {
    vi.useFakeTimers();
    try {
      const lateRelease = deferred<unknown>();
      const releaseSession = vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => lateRelease.promise);
      const cleanup = cleanupV4CodeBrowserbaseResources(
        {
          apiKey: "private-api-key",
          resources: { sessionId: "session-resource" },
        },
        () => ({
          releaseSession,
          retrieveSession: async () => ({ status: "RUNNING" }),
          deleteExtension: async () => undefined,
        }),
        {
          sessionCleanupTimeoutMs: 5,
          sessionReleaseRetryAfterMs: 1,
          sessionStatusPollIntervalMs: 1,
        },
      );
      const observed = cleanup.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(1);
      expect(releaseSession).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4);

      expectSessionCleanupTimeout(
        await observed,
        "requesting the fallback session release",
      );
      expect(vi.getTimerCount()).toBe(0);
      lateRelease.reject(new Error("late fallback rejection"));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
