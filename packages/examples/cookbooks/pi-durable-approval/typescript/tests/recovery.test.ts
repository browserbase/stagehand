import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld } from "@workflow/world-local";
import { acquireHarness, resumeWith } from "durable-harness/pi-durable";
import { registerQueue } from "durable-harness";
import { BACKGROUND_CONTEXT, openAgent } from "../src/pi.js";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { requestDecision } from "../src/state.js";

void test("Pi application state survives releasing and reacquiring a World-backed Harness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-world-"));
  const world = createWorld({ dataDir: directory, recoverActiveRuns: false });
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  const agents = new Map();
  const open = resumeWith(
    async (storage) => {
      const agent = await openAgent(storage, models);
      agents.set(agent.harness, agent);
      return agent.harness;
    },
    { world, name: "test-approval" },
  );
  registerQueue(world);
  let lease = await acquireHarness(undefined, open, { world, name: "test-approval" });
  try {
    const id = lease.storage.sessionId;
    await lease.harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    await agents.get(lease.harness).store.update((state: Parameters<typeof requestDecision>[0]) => {
      requestDecision(state, "Review order", { total: "42" }, "approval-1");
    });
    await lease.release();
    lease = await acquireHarness(id, open, { world, name: "test-approval" });
    const state = await agents.get(lease.harness).store.read();
    assert.equal(state.decision.id, "approval-1");
    assert.equal(state.decision.status, "pending");
    assert.deepEqual(state.decision.values, { total: "42" });
  } finally {
    await lease.release();
    await world.close?.();
    await rm(directory, { recursive: true, force: true });
  }
});
