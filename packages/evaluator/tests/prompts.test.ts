import { expect, test } from "vitest";
import { FUSED_JUDGMENT_PROMPT } from "../src/prompts/fusedJudgment.js";
import { FUSED_OUTCOME_PROMPT } from "../src/prompts/fusedOutcome.js";
import { renderPrompt } from "../src/prompts/render.js";

test.each([
  ["judgment", FUSED_JUDGMENT_PROMPT],
  ["outcome", FUSED_OUTCOME_PROMPT],
])("%s output example is valid JSON with correctly nested outcome fields", (kind, template) => {
  const prompt = renderPrompt(template, {});
  const start = prompt.indexOf("\n{\n");
  const end = prompt.indexOf("\n\n- Omit", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const example = JSON.parse(prompt.slice(start, end));
  expect(example.outcome).toMatchObject({ output_success: true });
  expect(example.outcome.primary_intent).toBeTypeOf("string");
  expect(example.outcome.reasoning).toBeTypeOf("string");
  expect(Object.keys(example.outcome.checks)).toEqual([
    "critical_point",
    "identity_and_constraints",
    "deliverable_completeness",
    "goal_achievability",
  ]);
  expect(example.primary_intent).toBeUndefined();
  if (kind === "judgment") expect(example.per_criterion).toHaveLength(1);
});

test("rendering preserves literal braces and dollar signs in task data", () => {
  const instruction = 'Inspect {{template}} and {"price":"$12"}';
  expect(renderPrompt("Task: $instruction", { instruction })).toBe(`Task: ${instruction}`);
});
