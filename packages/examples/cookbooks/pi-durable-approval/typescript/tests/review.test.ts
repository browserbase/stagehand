import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { reviewOrder } from "../src/review.js";
import { initialState, requestDecision, type Store } from "../src/state.js";
import { Terminal } from "../src/terminal.js";

function setup(answers: string) {
  let state = initialState();
  requestDecision(state, "Review order", { size: '["small"]' }, "approval-1");
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
    input: Readable.from([answers]),
    output: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
  return { store, terminal };
}

void test("approve and done continue the same run only after exact values were approved", async () => {
  const { store, terminal } = setup("approve\ndone\n");
  const browser = {
    liveLink: async () => {},
    formValues: async () => {
      assert.equal((await store.read()).decision?.status, "pending");
      return { size: '["small"]' };
    },
  };
  try {
    assert.equal(await reviewOrder(store, browser, terminal), true);
    assert.equal((await store.read()).decision?.status, "returned");
    assert.equal((await store.read()).confirmed, false);
  } finally {
    terminal.close();
  }
});

void test("changed values refuse approval and can be corrected before the next answer", async () => {
  const { store, terminal } = setup("approve\napprove\ndone\n");
  let reads = 0;
  try {
    assert.equal(
      await reviewOrder(
        store,
        {
          liveLink: async () => {},
          formValues: async () => ({ size: ++reads === 1 ? '["large"]' : '["small"]' }),
        },
        terminal,
      ),
      true,
    );
    assert.equal(reads, 2);
    assert.equal((await store.read()).decision?.status, "returned");
  } finally {
    terminal.close();
  }
});

void test("pause and rejection never grant approval or read form values", async () => {
  for (const answer of ["pause", "reject"]) {
    const { store, terminal } = setup(`${answer}\n`);
    try {
      assert.equal(
        await reviewOrder(
          store,
          {
            liveLink: async () => {},
            formValues: async () => {
              throw new Error("Must not read or approve");
            },
          },
          terminal,
        ),
        false,
      );
      assert.equal(
        (await store.read()).decision?.status,
        answer === "pause" ? "pending" : "rejected",
      );
    } finally {
      terminal.close();
    }
  }
});
