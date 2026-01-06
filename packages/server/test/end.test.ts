import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { serializerCompiler, validatorCompiler } from "fastify-zod-openapi";

import endRoute from "../src/routes/v1/sessions/_id/end.js";

const storeMocks = vi.hoisted(() => ({
  endSession: vi.fn(),
}));

vi.mock("../src/lib/sessionStoreManager.js", async () => {
  const fakeStore = {
    endSession: storeMocks.endSession,
  };
  return {
    getSessionStore: () => fakeStore,
    initializeSessionStore: () => fakeStore,
    destroySessionStore: async () => {},
  };
});

describe("/v1/sessions/:id/end body requirements", () => {
  let app: ReturnType<typeof fastify>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.route(endRoute);
  });

  afterEach(async () => {
    await app?.close();
  });

  test("returns 400 if JSON content-type has an empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions/sess-1/end",
      headers: { "content-type": "application/json" },
      payload: "",
    });

    expect(res.statusCode).toBe(400);
  });

  test("returns 400 if body contains extra keys", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions/sess-1/end",
      payload: { unexpected: true },
    });

    expect(res.statusCode).toBe(400);
  });

  test("returns 200 when body is {}", async () => {
    storeMocks.endSession.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/sessions/sess-1/end",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(storeMocks.endSession).toHaveBeenCalledWith("sess-1");
  });
});
