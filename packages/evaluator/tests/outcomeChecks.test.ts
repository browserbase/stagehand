import { expect, test } from "vitest";
import {
  checkedOutcomeState,
  disclosedFallback,
  environmentBlocked,
  goalUnachievable,
  OutcomeChecksSchema,
} from "../src/outcomeChecks.js";

const ok = { requirement: "r", evidence: "e", state: "supported" as const };

test("goal_achievability is optional and does not affect the three required checks", () => {
  const checks = OutcomeChecksSchema.parse({
    critical_point: ok,
    identity_and_constraints: ok,
    deliverable_completeness: ok,
  });
  expect(checkedOutcomeState({ state: "supported", output_success: true, checks })).toBe(
    "supported",
  );
  expect(goalUnachievable(checks)).toBe(false);
});

test("established unachievability never upgrades an uncompleted outcome, but is flagged", () => {
  const checks = OutcomeChecksSchema.parse({
    critical_point: ok,
    identity_and_constraints: { ...ok, state: "contradicted" },
    deliverable_completeness: ok,
    goal_achievability: {
      requirement: "buy heated foot spa",
      evidence: "Walgreens search: no results (step 9)",
      state: "unachievable_established",
    },
  });
  expect(checkedOutcomeState({ state: "contradicted", output_success: false, checks })).toBe(
    "contradicted",
  );
  expect(goalUnachievable(checks)).toBe(true);
});

test("environment blockers reported by the judge are distinguishable from unachievable goals", () => {
  const checks = OutcomeChecksSchema.parse({
    critical_point: ok,
    identity_and_constraints: ok,
    deliverable_completeness: { ...ok, state: "contradicted" },
    goal_achievability: {
      requirement: "book ticket",
      evidence: "hCaptcha challenge at checkout (step 31)",
      state: "environment_blocked",
    },
  });
  expect(environmentBlocked(checks)).toBe(true);
  expect(goalUnachievable(checks)).toBe(false);
  expect(checkedOutcomeState({ state: "contradicted", output_success: false, checks })).toBe(
    "contradicted",
  );
});

test("rubric-sanctioned disclosed fallback can pass and is categorized", () => {
  const checks = OutcomeChecksSchema.parse({
    critical_point: ok,
    identity_and_constraints: ok,
    deliverable_completeness: ok,
    goal_achievability: {
      requirement: "buy heated foot spa + epsom salt",
      evidence:
        "no foot spa sold (steps 3-9); rubric fallback: disclose + closest alternative; disclosed in final answer",
      state: "unachievable_fallback_accepted",
    },
  });
  expect(checkedOutcomeState({ state: "supported", output_success: true, checks })).toBe(
    "supported",
  );
  expect(disclosedFallback(checks)).toBe(true);
  expect(goalUnachievable(checks)).toBe(false);
});

test("a goal the judge marks unachievable or blocked can never be a supported outcome", () => {
  for (const state of ["unachievable_established", "environment_blocked"] as const) {
    const checks = OutcomeChecksSchema.parse({
      critical_point: ok,
      identity_and_constraints: ok,
      deliverable_completeness: ok,
      goal_achievability: {
        requirement: "park an F-150",
        evidence: "no garage accepts pickups (step 25)",
        state,
      },
    });
    expect(checkedOutcomeState({ state: "supported", output_success: true, checks })).toBe(
      "unresolved",
    );
  }
});
