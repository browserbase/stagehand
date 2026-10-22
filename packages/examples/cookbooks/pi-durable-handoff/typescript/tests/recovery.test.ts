import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT, openAgent } from "../src/pi.js";
import { decide, requestDecision } from "../src/state.js";

void test("a real Pi tool persists handoff and request deduplication across SQLite reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-handoff-"));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("handoff", { reason: "Enter the email code in Live View" }), {
      stopReason: "toolUse",
    }),
  ]);
  let agent = await openAgent(await openNodeSqliteStorage(join(directory, "agent.sqlite")), models);
  try {
    const root = await agent.harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const submitted = await root.submit(
      { type: "input", content: "Log in", requestId: "login" },
      BACKGROUND_CONTEXT,
    );
    const settled = await submitted.wait(BACKGROUND_CONTEXT);
    assert.equal(settled.status, "done");
    const pending = (await agent.store.read()).decision!;
    assert.equal(pending.status, "pending");
    await agent.harness.close(BACKGROUND_CONTEXT);
    agent = await openAgent(await openNodeSqliteStorage(join(directory, "agent.sqlite")), models);
    assert.deepEqual((await agent.store.read()).decision, pending);
    const reopened = await agent.harness.root(BACKGROUND_CONTEXT);
    const repeated = await reopened.submit(
      { type: "input", content: "Log in", requestId: "login" },
      BACKGROUND_CONTEXT,
    );
    assert.equal(repeated.id, submitted.id);
    await agent.store.update((state) => {
      decide(state, pending.id, "returned");
    });
    // A tool whose result was lost must reuse the settled handoff when replayed.
    await agent.store.update((state) => {
      requestDecision(state, pending.reason, {}, pending.id);
    });
    assert.equal((await agent.store.read()).decision?.status, "returned");
  } finally {
    await agent.harness.close(BACKGROUND_CONTEXT);
    await rm(directory, { recursive: true, force: true });
  }
});
