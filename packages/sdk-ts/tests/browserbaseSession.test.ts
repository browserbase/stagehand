import { describe, expect, it, vi } from "vitest";
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
    const createSdk = vi.fn(() => ({ sessions: { create, update } }));
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

  it("opts into the built-in Stagehand extension without provisioning an upload", async () => {
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const releaseSession = vi.fn(async () => {});
    const browserbase = fakeBrowserbaseApiClient({ createSession, releaseSession });
    const client = createBrowserbaseSessionClient("bb_key", { browserbase });

    const session = await client.createSession({
      browserSettings: {
        advancedStealth: true,
        extensions: ["browser-events", "stagehand", "browser-events"],
      },
      extensionId: "uploaded_extension_123",
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: {
        stagehand: "false",
        stagehand_sdk_language: "python",
        suite: "unit",
      },
    });

    expect(createSession).toHaveBeenCalledWith({
      browserSettings: {
        advancedStealth: true,
        extensions: ["browser-events", "stagehand"],
      },
      extensionId: "uploaded_extension_123",
      keepAlive: false,
      region: "eu-central-1",
      userMetadata: {
        stagehand: "true",
        stagehand_sdk_language: "typescript",
        suite: "unit",
      },
    });
    expect(session.cdpUrl).toBe("wss://connect.browserbase.com/devtools/browser/session_123");
    expect(session.sessionId).toBe("session_123");

    await session.close?.();
    await session.close?.();
    expect(releaseSession).toHaveBeenCalledOnce();
    expect(releaseSession).toHaveBeenCalledWith("session_123");
  });

  it("appends Stagehand while preserving existing extension order", async () => {
    const createSession = vi.fn(async () => ({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase: fakeBrowserbaseApiClient({ createSession }),
    });

    await client.createSession({
      browserSettings: { extensions: ["onepassword", "browser-events"] },
    });

    expect(createSession).toHaveBeenCalledWith({
      browserSettings: { extensions: ["onepassword", "browser-events", "stagehand"] },
      userMetadata: {
        stagehand: "true",
        stagehand_sdk_language: "typescript",
      },
    });
  });

  it("wraps session creation failures without extension cleanup", async () => {
    const createError = new Error("concurrency limit reached");
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase: fakeBrowserbaseApiClient({
        createSession: vi.fn(async () => {
          throw createError;
        }),
      }),
    });

    const error = await client.createSession({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Failed to create a Browserbase session");
    expect((error as Error).cause).toBe(createError);
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
    const releaseSession = vi.fn(async () => {});
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase: fakeBrowserbaseApiClient({
        createSession: vi.fn(async () => testCase.response),
        releaseSession,
      }),
    });

    await expect(client.createSession({})).rejects.toThrow(testCase.message);
    if (testCase.expectedRelease) {
      expect(releaseSession).toHaveBeenCalledWith(testCase.expectedRelease);
    } else {
      expect(releaseSession).not.toHaveBeenCalled();
    }
  });

  it("does not repeat a successful release", async () => {
    const releaseSession = vi.fn(async () => {});
    const client = createBrowserbaseSessionClient("bb_key", {
      browserbase: fakeBrowserbaseApiClient({ releaseSession }),
    });
    const session = await client.createSession({});

    await session.close?.();
    await session.close?.();
    expect(releaseSession).toHaveBeenCalledOnce();
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
    async releaseSession() {},
    ...overrides,
  };
}
