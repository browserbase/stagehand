import { describe, expect, it, vi } from "vitest";
import { cleanupV4CodeBrowserbaseResources } from "../../framework/v4CodeBrowserbaseCleanup.js";

describe("V4 Browserbase fallback cleanup", () => {
  it("releases the session before deleting the uploaded extension", async () => {
    const calls: string[] = [];
    const createClient = vi.fn(() => ({
      releaseSession: vi.fn(async (sessionId: string, projectId?: string) => {
        calls.push(`release:${sessionId}:${projectId}`);
      }),
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
          deleteExtension,
        }),
      ),
    ).rejects.toThrow(/Browserbase resource cleanup failed/i);
    expect(deleteExtension).toHaveBeenCalledOnce();
  });
});
