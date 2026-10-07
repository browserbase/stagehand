import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { checkedOutcomeState, OutcomeChecksSchema } from "../src/outcomeChecks.js";
import {
  loadOrGenerateChecklist,
  renderChecklist,
  requirementsContradicted,
} from "../src/requirements.js";
import type { CompletionRequest, LLMClient } from "../src/client.js";

const ok = { requirement: "r", evidence: "e", state: "supported" as const };
const checks = OutcomeChecksSchema.parse({
  critical_point: ok,
  identity_and_constraints: ok,
  deliverable_completeness: ok,
});

test("a contradicted requirement blocks an otherwise supported outcome; unresolved does not", () => {
  expect(
    checkedOutcomeState({
      state: "supported",
      output_success: true,
      checks,
      requirements: [{ state: "supported" }, { state: "unresolved" }],
    }),
  ).toBe("supported");
  expect(
    checkedOutcomeState({
      state: "supported",
      output_success: true,
      checks,
      requirements: [{ state: "contradicted" }],
    }),
  ).toBe("contradicted");
  expect(
    requirementsContradicted([{ id: "R1", state: "contradicted", evidence: "URL children=0" }]),
  ).toBe(true);
});

test("checklist is generated once per task/rubric and then served from cache", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "req-cache-"));
  let calls = 0;
  const client: LLMClient = {
    async createChatCompletion<T>(_req: CompletionRequest): Promise<T> {
      calls++;
      return {
        data: {
          requirements: [
            {
              id: "R1",
              requirement: "2 adults and a 6-year-old child",
              kind: "constraint",
              how_to_verify: "search URL adults/children params",
            },
          ],
        },
      } as T;
    },
  };
  const task = { id: "t1", instruction: "Find a package for two adults and a six-year-old" };
  const rubric = {
    items: [{ criterion: "Travelers", description: "2 adults + 1 child", maxPoints: 1 }],
  };
  const a = await loadOrGenerateChecklist({
    client,
    logger: () => {},
    task,
    rubric,
    cacheDir: dir,
  });
  const b = await loadOrGenerateChecklist({
    client,
    logger: () => {},
    task: { ...task },
    rubric: { ...rubric },
    cacheDir: dir,
  });
  expect(a?.requirements[0].id).toBe("R1");
  expect(b?.requirements[0].id).toBe("R1");
  expect(calls).toBe(1);
  expect(renderChecklist(a)).toContain("R1 [constraint] 2 adults and a 6-year-old child");
});

test("judge health check runs once per model per process across Evaluator instances", async () => {
  const { Evaluator } = await import("../src/evaluator.js");
  const { AISdkJudge } = await import("../src/client.js");
  let checks = 0;
  const judge = new AISdkJudge({ provider: "fixture", modelId: "judge-x" } as never);
  (judge as unknown as { validate: () => Promise<void> }).validate = async () => {
    checks++;
  };
  await new Evaluator({ client: judge, rubricClient: judge }).validate();
  await new Evaluator({ client: judge, rubricClient: judge }).validate();
  expect(checks).toBe(1);
});
