import { describe, expect, it, vi } from "vite-plus/test";
import {
  createBrowserbaseApiClient,
  createBrowserbaseSessionClient,
  type BrowserbaseApiClient,
} from "../src/browserbaseSession.js";

describe("Browserbase session creation", () => {
  it("maps session creation and release to the official SDK surface", async () => {
    const create = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const update = vi.fn(async () => ({}));
    const createSdk = vi.fn(() => ({
      extensions: {
        create: vi.fn(async () => ({ id: "ext_stagehand" })),
        delete: vi.fn(async () => {}),
      },
      sessions: { create, update },
    }));
    const client = createBrowserbaseApiClient("bb_key", createSdk);

    await expect(client.createSession({ region: "us-west-2" })).resolves.toStrictEqual({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    });
    await client.releaseSession("session_123");

    expect(createSdk).toHaveBeenCalledWith("bb_key");
    expect(create).toHaveBeenCalledWith({ region: "us-west-2" });
    expect(update).toHaveBeenCalledWith("session_123", { status: "REQUEST_RELEASE" });
  });

  it("creates a session with the provisioned extension and maps its connection URL", async () => {
    const cleanupExtension = vi.fn(async () => {});
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const releaseSession = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({ createSession, releaseSession });
    const provisionExtension = vi.fn(async () => ({
      extensionId: "ext_stagehand",
      cleanup: cleanupExtension,
    }));
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase,
      provisionExtension,
    });

    const session = await client.createSession({
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: { suite: "unit" },
    });

    expect(provisionExtension).toHaveBeenCalledWith(browserbase);
    expect(createSession).toHaveBeenCalledWith({
      extensionId: "ext_stagehand",
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: { suite: "unit" },
    });
    expect(session.cdpUrl).toBe("wss://connect.browserbase.com/devtools/browser/session_123");
    expect(session.sessionId).toBe("session_123");

    await session.close?.();
    await session.close?.();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledWith("session_123");
    expect(cleanupExtension).toHaveBeenCalledOnce();
  });

  it("deletes the uploaded extension when session creation fails", async () => {
    const createError = new Error("concurrency limit reached");
    const cleanupExtension = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({
      createSession: vi.fn(async () => {
        throw createError;
      }),
    });
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase,
      provisionExtension: async () => ({
        extensionId: "ext_stagehand",
        cleanup: cleanupExtension,
      }),
    });

    const error = await client.createSession({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Failed to create a Browserbase session");
    expect((error as Error).cause).toBe(createError);
    expect(cleanupExtension).toHaveBeenCalledOnce();
  });

  it.each([
    {
      response: { id: "", connectUrl: "wss://connect.browserbase.com/session" },
      message: "empty session ID",
      expectedRelease: undefined,
    },
    {
      response: { id: "session_123", connectUrl: " " },
      message: "empty connection URL",
      expectedRelease: "session_123",
    },
  ])("cleans up an invalid Browserbase response with $message", async (testCase) => {
    const cleanupExtension = vi.fn(async () => {});
    const releaseSession = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({
      createSession: vi.fn(async () => testCase.response),
      releaseSession,
    });
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase,
      provisionExtension: async () => ({
        extensionId: "ext_stagehand",
        cleanup: cleanupExtension,
      }),
    });

    await expect(client.createSession({})).rejects.toThrow(testCase.message);
    expect(cleanupExtension).toHaveBeenCalledOnce();
    if (testCase.expectedRelease) {
      expect(releaseSession).toHaveBeenCalledWith(testCase.expectedRelease);
    } else {
      expect(releaseSession).not.toHaveBeenCalled();
    }
  });

  it("deletes the uploaded extension even when session release fails", async () => {
    const cleanupExtension = vi.fn(async () => {});
    const releaseError = new Error("release failed");
    const browserbase = fakeBrowserbaseApiClient({
      releaseSession: vi.fn(async () => {
        throw releaseError;
      }),
    });
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase,
      provisionExtension: async () => ({
        extensionId: "ext_stagehand",
        cleanup: cleanupExtension,
      }),
    });
    const session = await client.createSession({});

    await expect(session.close?.()).rejects.toBe(releaseError);
    expect(cleanupExtension).toHaveBeenCalledOnce();
  });

  it("does not repeat a successful release when extension cleanup is retried", async () => {
    const cleanupError = new Error("extension cleanup failed");
    const cleanupExtension = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValueOnce();
    const releaseSession = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({ releaseSession });
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase,
      provisionExtension: async () => ({
        extensionId: "ext_stagehand",
        cleanup: cleanupExtension,
      }),
    });
    const session = await client.createSession({});

    await expect(session.close?.()).rejects.toBe(cleanupError);
    await expect(session.close?.()).resolves.toBeUndefined();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(cleanupExtension).toHaveBeenCalledTimes(2);
  });
});

function fakeBrowserbaseApiClient(
  overrides: Partial<BrowserbaseApiClient> = {},
): BrowserbaseApiClient {
  return {
    async uploadExtension() {
      return { id: "ext_stagehand" };
    },
    async deleteExtension() {},
    async createSession() {
      return {
        id: "session_123",
        connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      };
    },
    async releaseSession() {},
    ...overrides,
  };
}
