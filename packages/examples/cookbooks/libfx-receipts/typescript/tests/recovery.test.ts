import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileStore } from "../src/store.js";
import { requestDecision, decide } from "../src/state.js";

void test("completed receipts and human ownership survive manifest reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-manifest-"));
  try {
    const path = join(directory, "manifest.json");
    const store = new FileStore(path);
    await store.update((state) => {
      state.receipts.push({
        url: "https://merchant.example/receipts",
        records: [{ id: "invoice-1", total: "42" }],
      });
      requestDecision(state, "Sign into the next merchant", {}, "handoff-1");
    });
    const reopened = new FileStore(path);
    assert.equal((await reopened.read()).receipts[0]?.records[0]?.id, "invoice-1");
    await reopened.update((state) => {
      decide(state, "handoff-1", "returned");
    });
    await reopened.update((state) => {
      requestDecision(state, "Sign into the next merchant", {}, "handoff-1");
    });
    assert.equal((await new FileStore(path).read()).decision?.status, "returned");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
