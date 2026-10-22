import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFxAgent } from "libfx";
import { local } from "libfx/durable-local";

void test(
  "libfx persists a real turn and deduplicates its message after reopen",
  { timeout: 20_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "fx-local-"));
    let requests = 0;
    const create = () =>
      createFxAgent({
        name: "offline-receipts",
        model: "openai/test",
        apiKey: "offline-test",
        durability: local({ dir: directory }),
        modelCatalog: [
          { id: "openai/test", context_window: 128000, max_tokens: 1000, supports_tools: true },
        ],
        fetch: async () => {
          requests++;
          const chunks = [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "Receipts collected." },
            { type: "text-end", id: "0" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ];
          return new Response(
            chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
              "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
    let agent = create();
    try {
      const id = await agent.newSessionId();
      // Simulate exit after saving the session ID but before accepting the first input.
      await agent.close();
      agent = create();
      const first = agent.session(id).prompt("Collect receipts", { messageId: "initial" });
      await first.accepted;
      for await (const event of first) assert.equal(typeof event.type, "string");
      const firstResult = await first.result;
      assert.equal(firstResult.stopReason, "end_turn", JSON.stringify(firstResult));
      assert.equal(requests, 1);
      await agent.close();
      agent = create();
      const repeated = agent.session(id).prompt("Collect receipts", { messageId: "initial" });
      for await (const event of repeated) assert.equal(typeof event.type, "string");
      assert.equal((await repeated.result).stopReason, "end_turn");
      assert.equal(requests, 1);
      // A persisted human return can be delivered after reopen and deduplicated thereafter.
      const returned = agent.session(id).prompt("Human returned", { messageId: "return-login" });
      await returned.result;
      assert.equal(requests, 2);
      await agent.close();
      agent = create();
      await agent.session(id).prompt("Human returned", { messageId: "return-login" }).result;
      assert.equal(requests, 2);
    } finally {
      await agent.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
