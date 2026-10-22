import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { reviewSubmission } from "../src/review.js";
import { initialState, requestDecision, authorizeSubmit, type Store } from "../src/state.js";
import { Terminal } from "../src/terminal.js";

void test("interactive approval continues the run but does not bypass exact-value or attempt guards", async () => {
  let state = initialState();
  requestDecision(state, "Submit?", { size: '["small"]' }, "approval-1");
  const store: Store = {
    read: async () => structuredClone(state),
    update: async (change) => {
      const draft = structuredClone(state);
      change(draft);
      state = draft;
    },
  };
  const terminal = new Terminal({
    enabled: true,
    input: Readable.from(["approve\n"]),
    output: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
  try {
    assert.equal(await reviewSubmission(store, { liveLink: async () => {} }, terminal), true);
    assert.equal(state.decision?.status, "approved");
    assert.equal(state.attempted, false);
    assert.throws(() => authorizeSubmit(state, { size: '["large"]' }), /Form changed/);
    authorizeSubmit(state, { size: '["small"]' });
    state.attempted = true;
    assert.throws(() => authorizeSubmit(state, { size: '["small"]' }), /already attempted/);
  } finally {
    terminal.close();
  }
});

void test("pause and reject leave submission unattempted", async () => {
  for (const answer of ["pause", "reject"]) {
    const state = initialState();
    requestDecision(state, "Submit?", {}, "approval-1");
    const store: Store = { read: async () => state, update: async (change) => change(state) };
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
      assert.equal(await reviewSubmission(store, { liveLink: async () => {} }, terminal), false);
      assert.equal(state.decision?.status, answer === "pause" ? "pending" : "rejected");
      assert.equal(state.attempted, false);
    } finally {
      terminal.close();
    }
  }
});
