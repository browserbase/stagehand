import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, requestDecision, decide, assertBrowserControl } from "../src/state.js";

void test("a pending handoff blocks automation and rejects unrelated completion IDs", () => {
  const state = initialState();
  requestDecision(state, "Enter a code", {}, "request-1");
  assert.throws(() => assertBrowserControl(state), /Human owns/);
  assert.throws(() => decide(state, "other-request", "returned"), /Unknown/);
  decide(state, "request-1", "returned");
  assert.doesNotThrow(() => assertBrowserControl(state));
  requestDecision(state, "Enter a code", {}, "request-1");
  assert.equal(state.decision?.status, "returned");
});

void test("rejection cannot later become approval", () => {
  const state = initialState();
  requestDecision(state, "Review", {}, "approval-1");
  decide(state, "approval-1", "rejected");
  assert.throws(() => decide(state, "approval-1", "approved"), /already settled/);
});
