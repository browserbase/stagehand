import assert from "node:assert/strict";
import { test } from "node:test";
import { SubmissionGuard } from "../src/approval.js";

await test("rejecting approval blocks submission even if the model requests it again", () => {
  const guard = new SubmissionGuard();
  assert.throws(() => guard.claimSubmit());
  assert.throws(() => guard.decide(true));
  guard.beforeFill();
  guard.markFilled();
  guard.decide(false);
  assert.throws(() => guard.claimSubmit());
  assert.throws(() => guard.decide(true));
  assert.throws(() => guard.beforeFill());
});
await test("approved submission cannot be retried after success or an ambiguous browser failure", () => {
  const guard = new SubmissionGuard();
  guard.beforeFill();
  guard.markFilled();
  guard.decide(true);
  guard.claimSubmit();
  assert.throws(() => guard.claimSubmit());
  assert.throws(() => guard.beforeFill());
});

await test("concurrent or repeated fill requests cannot change the approval payload", () => {
  const guard = new SubmissionGuard();
  guard.beforeFill();
  assert.throws(() => guard.beforeFill());
  guard.markFilled();
  assert.throws(() => guard.beforeFill());
});
