import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { returnFromHandoff } from "../src/review.js";
import { initialState, requestDecision, type Store } from "../src/state.js";
import { Terminal } from "../src/terminal.js";

void test("done returns browser ownership and preserves completed collection", async () => {
  for (const answer of ["done", "pause"]) {
    const state = initialState();
    state.calls = 20;
    state.receipts = [{ url: "https://example.com/receipts", records: [{ id: "saved" }] }];
    requestDecision(state, "Sign in", {}, "handoff-1");
    const store: Store = {
      read: async () => structuredClone(state),
      update: async (change) => change(state),
    };
    const terminal = new Terminal({
      enabled: true,
      input: Readable.from([`${answer}\n`]),
      output: new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    });
    try {
      assert.equal(
        await returnFromHandoff(store, { liveLink: async () => {} }, terminal),
        answer === "done",
      );
      assert.equal(state.decision?.status, answer === "done" ? "returned" : "pending");
      assert.equal(state.calls, answer === "done" ? 0 : 20);
      assert.equal(state.receipts[0]?.records[0]?.id, "saved");
    } finally {
      terminal.close();
    }
  }
});
