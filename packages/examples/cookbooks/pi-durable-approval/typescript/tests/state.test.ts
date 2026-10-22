import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, requestDecision, decide, approveOrder } from "../src/state.js";

void test("approval binds the exact form values and decision ID", () => {
  const state = initialState();
  requestDecision(state, "Review", { total: "42", reference: "order-1" }, "approval-1");
  assert.throws(() => approveOrder(state, "other", state.decision!.values), /Unknown/);
  assert.throws(
    () => approveOrder(state, "approval-1", { total: "43", reference: "order-1" }),
    /changed/,
  );
  assert.equal(state.decision?.status, "pending");
  approveOrder(state, "approval-1", { reference: "order-1", total: "42" });
  assert.equal(state.decision?.status, "approved");
});

void test("rejection cannot later become approval", () => {
  const state = initialState();
  requestDecision(state, "Review", {}, "approval-1");
  decide(state, "approval-1", "rejected");
  assert.throws(() => decide(state, "approval-1", "approved"), /already settled/);
});
