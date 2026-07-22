import { describe, expect, it, vi } from "vitest";
import { cleanupV4CodeBrowserbaseResources } from "../../framework/v4CodeBrowserbaseCleanup.js";

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
});
