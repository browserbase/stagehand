import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, requestDecision, decide, authorizeSubmit } from "../src/state.js";

void test("approval is bound to exact values and an attempted action cannot repeat", () => {
  const state = initialState();
  requestDecision(state, "Review", { total: "42", reference: "order-1" }, "approval-1");
  assert.throws(() => authorizeSubmit(state, state.decision!.values), /approval/);
  decide(state, "approval-1", "approved");
  assert.throws(() => authorizeSubmit(state, { total: "43", reference: "order-1" }), /changed/);
  assert.doesNotThrow(() => authorizeSubmit(state, { reference: "order-1", total: "42" }));
  state.attempted = true;
  assert.throws(() => authorizeSubmit(state, state.decision!.values), /already attempted/);
});

void test("rejection cannot later become approval", () => {
  const state = initialState();
  requestDecision(state, "Review", {}, "approval-1");
  decide(state, "approval-1", "rejected");
  assert.throws(() => decide(state, "approval-1", "approved"), /already settled/);
});
