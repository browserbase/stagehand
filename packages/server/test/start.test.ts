import fastify from "fastify";
import { randomUUID } from "crypto";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import startRoute from "../src/routes/v1/sessions/start.js";

const bbMocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@browserbasehq/sdk", () => {
  return {
    default: class Browserbase {
      sessions = {
        retrieve: bbMocks.retrieve,
        create: bbMocks.create,
      };
      constructor() {
        // noop
      }
    },
  };
});

// Session store mocks
const storeMocks = vi.hoisted(() => ({
  getOrCreateStagehand: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("../src/lib/sessionStoreManager.js", async () => {
  const fakeStore = {
    startSession: storeMocks.startSession,
    getOrCreateStagehand: storeMocks.getOrCreateStagehand,
  };
  return {
    getSessionStore: () => fakeStore,
    initializeSessionStore: () => fakeStore,
    destroySessionStore: async () => {},
  };
});

describe("/v1/sessions/start cdpUrl responses", () => {
  let app: ReturnType<typeof fastify>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = fastify({ logger: false });
    // disable built-in validation to mirror server.ts
    app.setValidatorCompiler(() => () => true);
    app.route(startRoute);
  });

  afterAll(async () => {
    await app.close();
  });

  test("returns cdpUrl for local browser requests", async () => {
    const sessionId = "uuid-" + randomUUID();
    storeMocks.startSession.mockResolvedValue({ sessionId, available: true });
    storeMocks.getOrCreateStagehand.mockResolvedValue({
      connectURL: () => "ws://local-cdp",
    });

    const res = await app.inject({
      method: "POST",
      url: "/sessions/start",
      payload: {
        modelName: "openai/gpt-4.1-mini",
        browser: { type: "local" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      success: boolean;
      data: { sessionId: string; cdpUrl?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBe(sessionId);
    expect(body.data.cdpUrl).toBe("ws://local-cdp");
  });

  test("returns cdpUrl from Browserbase for browserbase requests", async () => {
    storeMocks.startSession.mockResolvedValue({
      sessionId: "bb-123",
      available: true,
    });
    bbMocks.retrieve.mockResolvedValue({
      id: "bb-123",
      connectUrl: "wss://bb-cdp",
      createdAt: "",
      expiresAt: "",
      keepAlive: false,
      projectId: "",
      proxyBytes: 0,
      region: "us-west-2",
      startedAt: "",
      status: "RUNNING",
      updatedAt: "",
    });

    const res = await app.inject({
      method: "POST",
      url: "/sessions/start",
      payload: {
        modelName: "openai/gpt-4.1-mini",
        browser: { type: "browserbase" },
        browserbaseSessionID: "bb-123",
      },
      headers: {
        "x-bb-api-key": "k",
        "x-bb-project-id": "p",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      success: boolean;
      data: { sessionId: string; cdpUrl?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBe("bb-123");
    expect(body.data.cdpUrl).toBe("wss://bb-cdp");
  });
});
