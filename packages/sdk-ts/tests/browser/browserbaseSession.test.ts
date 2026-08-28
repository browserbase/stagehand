import { describe, expect, it, vi } from "vitest";
import {
  BrowserbaseSessionError,
  createBrowserbaseApiClient,
  createBrowserbaseSessionClient,
  type BrowserbaseApiClient,
} from "../../src/browser/browserbaseSession.js";
import { STAGEHAND_SDK_VERSION } from "../../src/version.js";

describe("Browserbase session creation", () => {
  it("maps session creation and release to the official SDK surface", async () => {
    const create = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const update = vi.fn(async () => ({}));
    const retrieve = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "us-west-2" as const,
    }));
    const createSdk = vi.fn(() => ({
      extensions: {
        create: vi.fn(async () => ({ id: "ext_stagehand" })),
        delete: vi.fn(async () => {}),
      },
      sessions: { create, retrieve, update },
    }));
    const client = createBrowserbaseApiClient(
      "bb_key",
      "https://api.dev.browserbase.com",
      createSdk,
    );

    await expect(client.createSession({ region: "us-west-2" })).resolves.toStrictEqual({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    });
    await client.releaseSession("session_123");
    await expect(client.retrieveSession("session_123")).resolves.toStrictEqual({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "us-west-2",
    });

    expect(createSdk).toHaveBeenCalledWith("bb_key", "https://api.dev.browserbase.com");
    expect(create).toHaveBeenCalledWith({ region: "us-west-2" });
    expect(update).toHaveBeenCalledWith("session_123", { status: "REQUEST_RELEASE" });
    expect(retrieve).toHaveBeenCalledWith("session_123");
  });

  it("validates session data returned by the Browserbase SDK", async () => {
    const client = createBrowserbaseApiClient("bb_key", "https://api.browserbase.com", () => ({
      extensions: {
        create: vi.fn(async () => ({ id: "ext_stagehand" })),
        delete: vi.fn(async () => {}),
      },
      sessions: {
        create: vi.fn(async () => ({ id: "session_123", connectUrl: 42 })),
        retrieve: vi.fn(async () => ({
          id: "session_123",
          connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          region: "moon-1",
        })),
        update: vi.fn(async () => ({})),
      },
    }));

    await expect(client.createSession({})).rejects.toThrow();
    await expect(client.retrieveSession("session_123")).rejects.toThrow();
  });

  it("connects to and explicitly releases an existing running session", async () => {
    const retrieveSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "eu-central-1" as const,
    }));
    const releaseSession = vi.fn(async () => {});
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase: fakeBrowserbaseApiClient({ retrieveSession, releaseSession }),
      provisionExtension: vi.fn(),
    });

    const connection = await client.connectSession?.("session_123");
    expect(connection).toMatchObject({
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "eu-central-1",
    });
    expect(retrieveSession).toHaveBeenCalledWith("session_123");
    expect(releaseSession).not.toHaveBeenCalled();

    await connection?.close?.();
    await connection?.close?.();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledWith("session_123");
  });

  it("rejects a Browserbase session without a connection URL", async () => {
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase: fakeBrowserbaseApiClient({
        retrieveSession: async () => ({ id: "session_123" }),
      }),
      provisionExtension: vi.fn(),
    });

    await expect(client.connectSession?.("session_123")).rejects.toThrow(
      "not available for connection",
    );
  });

  it("sanitizes Browserbase session retrieval failures", async () => {
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase: fakeBrowserbaseApiClient({
        retrieveSession: async () => {
          throw new Error("request failed for bb_secret at wss://private.example");
        },
      }),
      provisionExtension: vi.fn(),
    });

    const error = await client.connectSession?.("session_123").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrowserbaseSessionError);
    expect((error as Error).message).toBe("Failed to retrieve the Browserbase session");
    expect((error as Error).cause).toBeUndefined();
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
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase,
      provisionExtension,
    });

    const session = await client.createSession({
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: {
        stagehand: "false",
        stagehand_sdk_language: "python",
        stagehand_sdk_version: "0.0.0-spoofed",
        suite: "unit",
      },
    });

    expect(provisionExtension).toHaveBeenCalledWith(browserbase);
    expect(createSession).toHaveBeenCalledWith({
      extensionId: "ext_stagehand",
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: {
        stagehand: "true",
        stagehand_sdk_language: "typescript",
        stagehand_sdk_version: STAGEHAND_SDK_VERSION,
        suite: "unit",
      },
    });
    expect(session.cdpUrl).toBe("wss://connect.browserbase.com/devtools/browser/session_123");
    expect(session.sessionId).toBe("session_123");

    await session.close?.();
    await session.close?.();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledWith("session_123");
    expect(cleanupExtension).toHaveBeenCalledOnce();
  });

  it.each([{ extensionId: "ext_caller" }, { browserSettings: { extensionId: "ext_caller" } }])(
    "reuses a caller-owned extension without provisioning or deleting it",
    async (params) => {
      const createSession = vi.fn(async () => ({
        id: "session_123",
        connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      }));
      const releaseSession = vi.fn(async () => {});
      const provisionExtension = vi.fn();
      const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
        browserbase: fakeBrowserbaseApiClient({ createSession, releaseSession }),
        provisionExtension,
      });

      const session = await client.createSession(params);

      expect(provisionExtension).not.toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledWith({
        ...params,
        userMetadata: {
          stagehand: "true",
          stagehand_sdk_language: "typescript",
          stagehand_sdk_version: STAGEHAND_SDK_VERSION,
        },
      });

      await session.close?.();
      expect(releaseSession).toHaveBeenCalledWith("session_123");
    },
  );

  it("deletes the uploaded extension when session creation fails", async () => {
    const createError = new Error("concurrency limit reached");
    const cleanupExtension = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({
      createSession: vi.fn(async () => {
        throw createError;
      }),
    });
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase,
      provisionExtension: async () => ({
        extensionId: "ext_stagehand",
        cleanup: cleanupExtension,
      }),
    });

    const error = await client.createSession({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrowserbaseSessionError);
    expect((error as Error).message).toBe("Failed to create a Browserbase session");
    expect((error as Error).cause).toBeUndefined();
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
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
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
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
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
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
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
    async retrieveSession(sessionId) {
      return {
        id: sessionId,
        connectUrl: `wss://connect.browserbase.com/devtools/browser/${sessionId}`,
      };
    },
    async releaseSession() {},
    ...overrides,
  };
}
