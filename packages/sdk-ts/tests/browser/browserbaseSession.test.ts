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
    const createSdk = vi.fn(() => ({ sessions: { create, retrieve, update } }));
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

  it("connects to an existing running session without taking release ownership", async () => {
    const retrieveSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "eu-central-1" as const,
    }));
    const releaseSession = vi.fn(async () => {});
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase: fakeBrowserbaseApiClient({ retrieveSession, releaseSession }),
    });

    await expect(client.connectSession?.("session_123")).resolves.toStrictEqual({
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "eu-central-1",
    });
    expect(retrieveSession).toHaveBeenCalledWith("session_123");
    expect(releaseSession).not.toHaveBeenCalled();
  });

  it("rejects a Browserbase session without a connection URL", async () => {
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase: fakeBrowserbaseApiClient({
        retrieveSession: async () => ({ id: "session_123" }),
      }),
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
    });

    const error = await client.connectSession?.("session_123").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrowserbaseSessionError);
    expect((error as Error).message).toBe("Failed to retrieve the Browserbase session");
    expect((error as Error).cause).toBeUndefined();
  });

  it("opts into the built-in Stagehand extension and maps the connection URL", async () => {
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const releaseSession = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({ createSession, releaseSession });
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase,
    });
    const params = {
      keepAlive: false,
      region: "eu-central-1" as const,
      userMetadata: {
        stagehand: "false",
        stagehand_sdk_language: "python",
        stagehand_sdk_version: "0.0.0-spoofed",
        suite: "unit",
      },
    };

    const session = await client.createSession(params);

    expect(createSession).toHaveBeenCalledWith({
      browserSettings: { extensions: ["stagehand"] },
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: {
        stagehand: "true",
        stagehand_sdk_language: "typescript",
        stagehand_sdk_version: STAGEHAND_SDK_VERSION,
        suite: "unit",
      },
    });
    expect(params).not.toHaveProperty("browserSettings");
    expect(session.cdpUrl).toBe("wss://connect.browserbase.com/devtools/browser/session_123");
    expect(session.sessionId).toBe("session_123");

    await session.close?.();
    await session.close?.();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledWith("session_123");
  });

  it.each([
    {
      extensions: ["onepassword", "browser-events", "onepassword"] as const,
      expected: ["onepassword", "browser-events", "stagehand"],
    },
    {
      extensions: ["stagehand", "onepassword", "stagehand"] as const,
      expected: ["stagehand", "onepassword"],
    },
    { extensions: [] as const, expected: ["stagehand"] },
  ])("dedupes caller extensions in order and appends stagehand: $extensions", async (testCase) => {
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase: fakeBrowserbaseApiClient({ createSession }),
    });
    const extensions = [...testCase.extensions];
    const browserSettings = { advancedStealth: true, extensionId: "ext_nested", extensions };

    await client.createSession({ browserSettings, extensionId: "ext_top" });

    expect(createSession).toHaveBeenCalledWith({
      browserSettings: {
        advancedStealth: true,
        extensionId: "ext_nested",
        extensions: testCase.expected,
      },
      extensionId: "ext_top",
      userMetadata: {
        stagehand: "true",
        stagehand_sdk_language: "typescript",
        stagehand_sdk_version: STAGEHAND_SDK_VERSION,
      },
    });
    expect(browserSettings.extensions).toBe(extensions);
    expect(extensions).toStrictEqual([...testCase.extensions]);
  });

  it.each([{ extensionId: "ext_caller" }, { browserSettings: { extensionId: "ext_caller" } }])(
    "passes a caller-owned extension ID through untouched",
    async (params) => {
      const createSession = vi.fn(async () => ({
        id: "session_123",
        connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      }));
      const releaseSession = vi.fn(async () => {});
      const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
        browserbase: fakeBrowserbaseApiClient({ createSession, releaseSession }),
      });

      const session = await client.createSession(params);

      expect(createSession).toHaveBeenCalledWith({
        ...params,
        browserSettings: { ...params.browserSettings, extensions: ["stagehand"] },
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

  it("sanitizes session creation failures without any cleanup calls", async () => {
    const createError = new Error("concurrency limit reached for bb_secret");
    const releaseSession = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({
      createSession: vi.fn(async () => {
        throw createError;
      }),
      releaseSession,
    });
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase,
    });

    const error = await client.createSession({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrowserbaseSessionError);
    expect((error as Error).message).toBe("Failed to create a Browserbase session");
    expect((error as Error).cause).toBeUndefined();
    expect(releaseSession).not.toHaveBeenCalled();
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
  ])(
    "releases only the session for an invalid Browserbase response with $message",
    async (testCase) => {
      const releaseSession = vi.fn(async () => {});
      const browserbase = fakeBrowserbaseApiClient({
        createSession: vi.fn(async () => testCase.response),
        releaseSession,
      });
      const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
        browserbase,
      });

      await expect(client.createSession({})).rejects.toThrow(testCase.message);
      if (testCase.expectedRelease) {
        expect(releaseSession).toHaveBeenCalledWith(testCase.expectedRelease);
      } else {
        expect(releaseSession).not.toHaveBeenCalled();
      }
    },
  );

  it("retries a failed release and does not repeat a successful one", async () => {
    const releaseError = new Error("release failed");
    const releaseSession = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(releaseError)
      .mockResolvedValue();
    const browserbase = fakeBrowserbaseApiClient({ releaseSession });
    const client = createBrowserbaseSessionClient("bb_key", "https://api.browserbase.com", {
      browserbase,
    });
    const session = await client.createSession({});

    await expect(session.close?.()).rejects.toBe(releaseError);
    await expect(session.close?.()).resolves.toBeUndefined();
    await expect(session.close?.()).resolves.toBeUndefined();
    expect(releaseSession).toHaveBeenCalledTimes(2);
  });
});

function fakeBrowserbaseApiClient(
  overrides: Partial<BrowserbaseApiClient> = {},
): BrowserbaseApiClient {
  return {
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
