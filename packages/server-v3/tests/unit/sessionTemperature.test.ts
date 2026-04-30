import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemorySessionStore } from "../../src/lib/InMemorySessionStore.js";

describe("v3 session temperature config", () => {
  it("persists explicit null temperature from session start config", async () => {
    const store = new InMemorySessionStore();
    const session = await store.startSession({
      browserType: "local",
      modelName: "openai/gpt-5-mini",
      temperature: null,
    });

    const config = await store.getSessionConfig(session.sessionId);

    assert.equal(config.temperature, null);
    await store.destroy();
  });

  it("persists numeric temperature from session start config", async () => {
    const store = new InMemorySessionStore();
    const session = await store.startSession({
      browserType: "local",
      modelName: "openai/gpt-4.1-mini",
      temperature: 0.2,
    });

    const config = await store.getSessionConfig(session.sessionId);

    assert.equal(config.temperature, 0.2);
    await store.destroy();
  });
});
