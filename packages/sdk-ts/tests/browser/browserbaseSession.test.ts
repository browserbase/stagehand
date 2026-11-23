import { describe, expect, it, vi } from "vitest";
import Browserbase from "@browserbasehq/sdk";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import {
  BrowserbaseSessionError,
  createBrowserbaseApiClient,
  createBrowserbaseSessionClient,
  type BrowserbaseApiClient,
} from "../../src/browser/browserbaseSession.js";
import type { BrowserbaseClientOptions } from "../../src/clientSchemas.js";
import { STAGEHAND_SDK_CLIENT_INFO } from "../../src/sdkIdentity.js";
import { STAGEHAND_SDK_VERSION } from "../../src/version.js";

const FINGERPRINT = "a".repeat(64);

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
    const clientOptions = { timeout: 5_000, maxRetries: 0 };
    const client = createBrowserbaseApiClient(
      "bb_key",
      "https://api.dev.browserbase.com",
      clientOptions,
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

    expect(createSdk).toHaveBeenCalledWith(
      "bb_key",
      "https://api.dev.browserbase.com",
      clientOptions,
    );
    expect(create).toHaveBeenCalledWith({ region: "us-west-2" });
    expect(update).toHaveBeenCalledWith("session_123", { status: "REQUEST_RELEASE" });
    expect(retrieve).toHaveBeenCalledWith("session_123");
  });

  it("builds the Browserbase SDK client from the supplied client options", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "session_123",
            connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = createBrowserbaseApiClient("bb_key", "https://api.dev.browserbase.com", {
      defaultHeaders: { "X-Caller": "app" },
      defaultQuery: { trace: "1" },
      maxRetries: 0,
      fetch: fetch as unknown as BrowserbaseClientOptions["fetch"],
    });

    await client.createSession({ region: "us-west-2" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.dev.browserbase.com/v1/sessions?trace=1");
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("X-Caller")).toBe("app");
    expect(headers.get("X-BB-API-Key")).toBe("bb_key");
  });

  it("validates session data returned by the Browserbase SDK", async () => {
    const client = createBrowserbaseApiClient("bb_key", "https://api.browserbase.com", {}, () => ({
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
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase: fakeBrowserbaseApiClient({ retrieveSession, releaseSession }),
        provisionExtension: vi.fn(),
      },
    );

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
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase: fakeBrowserbaseApiClient({
          retrieveSession: async () => ({ id: "session_123" }),
        }),
        provisionExtension: vi.fn(),
      },
    );

    await expect(client.connectSession?.("session_123")).rejects.toThrow(
      "not available for connection",
    );
  });

  it("sanitizes Browserbase session retrieval failures", async () => {
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase: fakeBrowserbaseApiClient({
          retrieveSession: async () => {
            throw new Error("request failed for bb_secret at wss://private.example");
          },
        }),
        provisionExtension: vi.fn(),
      },
    );

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
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase,
        provisionExtension,
      },
    );

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
      const client = createBrowserbaseSessionClient(
        "bb_key",
        "https://api.browserbase.com",
        {},
        {
          browserbase: fakeBrowserbaseApiClient({ createSession, releaseSession }),
          provisionExtension,
        },
      );

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

  it.each([{}, { extensionId: "ext_caller" }, { browserSettings: { extensionId: "ext_caller" } }])(
    "loads the built-in extension without uploading one when stagehand is true",
    async (params) => {
      const createSession = vi.fn(async () => ({
        id: "session_123",
        connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      }));
      const releaseSession = vi.fn(async () => {});
      const provisionExtension = vi.fn();
      const client = createBrowserbaseSessionClient(
        "bb_key",
        "https://api.browserbase.com",
        {},
        {
          browserbase: fakeBrowserbaseApiClient({ createSession, releaseSession }),
          provisionExtension,
          readExtensionFingerprint: async () => FINGERPRINT,
        },
      );

      const session = await client.createSession({ ...params, stagehand: true });
      await session.close?.();

      expect(provisionExtension).not.toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledWith({
        ...params,
        stagehand: {
          protocolVersion: STAGEHAND_PROTOCOL_VERSION,
          clientInfo: { ...STAGEHAND_SDK_CLIENT_INFO },
          extensionFingerprint: FINGERPRINT,
        },
        userMetadata: {
          stagehand: "true",
          stagehand_sdk_language: "typescript",
          stagehand_sdk_version: STAGEHAND_SDK_VERSION,
        },
      });
      expect(releaseSession).toHaveBeenCalledWith("session_123");
    },
  );

  it("omits an unreadable extension fingerprint from the built-in extension request", async () => {
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase: fakeBrowserbaseApiClient({ createSession }),
        provisionExtension: vi.fn(),
        readExtensionFingerprint: async () => {
          throw new Error("missing build file");
        },
      },
    );

    await client.createSession({ stagehand: true });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stagehand: {
          protocolVersion: STAGEHAND_PROTOCOL_VERSION,
          clientInfo: { ...STAGEHAND_SDK_CLIENT_INFO },
        },
      }),
    );
  });

  it("uploads the bundled extension and sends no stagehand key when stagehand is false", async () => {
    const cleanupExtension = vi.fn(async () => {});
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const provisionExtension = vi.fn(async () => ({
      extensionId: "ext_stagehand",
      cleanup: cleanupExtension,
    }));
    const readExtensionFingerprint = vi.fn(async () => FINGERPRINT);
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase: fakeBrowserbaseApiClient({ createSession }),
        provisionExtension,
        readExtensionFingerprint,
      },
    );

    const session = await client.createSession({ stagehand: false });
    await session.close?.();

    expect(provisionExtension).toHaveBeenCalledOnce();
    expect(readExtensionFingerprint).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith({
      extensionId: "ext_stagehand",
      userMetadata: {
        stagehand: "true",
        stagehand_sdk_language: "typescript",
        stagehand_sdk_version: STAGEHAND_SDK_VERSION,
      },
    });
    expect(cleanupExtension).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 400, hinted: true },
    { status: 401, hinted: false },
    { status: undefined, hinted: false },
  ])(
    "adds the built-in extension hint only to a 400 when stagehand is true (status $status)",
    async ({ status, hinted }) => {
      const client = createBrowserbaseSessionClient(
        "bb_key",
        "https://api.browserbase.com",
        {},
        {
          browserbase: fakeBrowserbaseApiClient({
            createSession: vi.fn(async () => {
              throw status === undefined
                ? new Error("socket hang up for bb_secret")
                : apiError(status, "stagehand rejected for bb_secret");
            }),
          }),
          provisionExtension: vi.fn(),
          readExtensionFingerprint: async () => FINGERPRINT,
        },
      );

      const error = await client
        .createSession({ stagehand: true })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BrowserbaseSessionError);
      expect((error as Error).message).toBe(
        hinted
          ? "Failed to create a Browserbase session. If Browserbase's built-in Stagehand extension " +
              "is not available for this project or region yet, remove `stagehand: true` to " +
              "upload the bundled one."
          : "Failed to create a Browserbase session",
      );
      expect((error as Error).cause).toBeUndefined();
    },
  );

  it.each([{}, { stagehand: false }])(
    "deletes the uploaded extension when session creation fails with %j",
    async (params) => {
      const cleanupExtension = vi.fn(async () => {});
      const browserbase = fakeBrowserbaseApiClient({
        createSession: vi.fn(async () => {
          throw apiError(400, "stagehand rejected for bb_secret");
        }),
      });
      const client = createBrowserbaseSessionClient(
        "bb_key",
        "https://api.browserbase.com",
        {},
        {
          browserbase,
          provisionExtension: async () => ({
            extensionId: "ext_stagehand",
            cleanup: cleanupExtension,
          }),
        },
      );

      const error = await client.createSession(params).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BrowserbaseSessionError);
      expect((error as Error).message).toBe("Failed to create a Browserbase session");
      expect((error as Error).cause).toBeUndefined();
      expect(cleanupExtension).toHaveBeenCalledOnce();
    },
  );

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
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase,
        provisionExtension: async () => ({
          extensionId: "ext_stagehand",
          cleanup: cleanupExtension,
        }),
      },
    );

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
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase,
        provisionExtension: async () => ({
          extensionId: "ext_stagehand",
          cleanup: cleanupExtension,
        }),
      },
    );
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
    const client = createBrowserbaseSessionClient(
      "bb_key",
      "https://api.browserbase.com",
      {},
      {
        browserbase,
        provisionExtension: async () => ({
          extensionId: "ext_stagehand",
          cleanup: cleanupExtension,
        }),
      },
    );
    const session = await client.createSession({});

    await expect(session.close?.()).rejects.toBe(cleanupError);
    await expect(session.close?.()).resolves.toBeUndefined();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(cleanupExtension).toHaveBeenCalledTimes(2);
  });
});

function apiError(status: number, message: string) {
  return Browserbase.APIError.generate(status, { message }, undefined, {});
}

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
