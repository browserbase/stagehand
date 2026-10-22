import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld } from "@workflow/world-local";
import { defineDoc, durableSessions, readDoc, type Harness } from "durable-harness";
import {
  authorizeSubmit,
  decide,
  initialState,
  requestDecision,
  type State,
} from "../src/state.js";

void test("a committed pre-submit marker survives World recovery and refuses another attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "submission-world-"));
  const work = defineDoc<State>({ kind: "test.submission", version: 1, initial: initialState });
  const harness: Harness = { name: "offline-test", async drive() {} };
  let world = createWorld({ dataDir: directory, recoverActiveRuns: false });
  try {
    let sessions = durableSessions({ world, harness });
    const { sessionId } = await sessions.start();
    await sessions.updateDoc(sessionId, work, (state) => {
      requestDecision(state, "Submit?", { comments: "request-1" }, "approval-1");
      decide(state, "approval-1", "approved");
      authorizeSubmit(state, { comments: "request-1" });
      state.attempted = true;
    });
    await world.close?.();
    world = createWorld({ dataDir: directory, recoverActiveRuns: false });
    sessions = durableSessions({ world, harness });
    const recovered = readDoc(await sessions.inspect(sessionId), work).value;
    assert.equal(recovered.attempted, true);
    assert.throws(
      () => authorizeSubmit(structuredClone(recovered) as State, { comments: "request-1" }),
      /already attempted/,
    );
  } finally {
    await world.close?.();
    await rm(directory, { recursive: true, force: true });
  }
});
