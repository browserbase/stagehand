import { expect, test } from "vitest";
import { detectBrowserUse, executionIssues } from "../src/diagnostics.js";
import type { Trajectory, TrajectoryStep } from "../src/types.js";

const step = (name: string, args = {}, ok = true): TrajectoryStep => ({
  actionName: name,
  actionArgs: args,
  reasoning: "",
  agentEvidence: { modalities: [] },
  probeEvidence: {},
  toolOutput: { ok, result: {} },
});

test("recorded server identity takes priority over generic and misleading names", () => {
  expect(
    detectBrowserUse([step("mcp", { providerIdentifier: "stagehand", toolName: "run" })]),
  ).toMatchObject({ used: true, rule: "recorded-server" });
  expect(detectBrowserUse([step("mcp", { providerIdentifier: "filesystem" })]).used).toBe(false);
  expect(detectBrowserUse([step("stagehand.run", { serverName: "filesystem" })]).used).toBe(false);
  expect(detectBrowserUse([step("mcp")]).used).toBe(false);
  expect(detectBrowserUse([step("stagehand.run", {}, false)]).used).toBe(false);
});

test.each([
  "run",
  "snapshot",
  "screenshot",
  "stagehand.run",
  "mcp__stagehand__run",
  "stagehand_run",
  "provider.stagehand.snapshot",
  "stagehand.stagehand-run",
])("recognizes legacy %s with a recorded fallback rule", (name) => {
  expect(detectBrowserUse([step(name)])).toMatchObject({ used: true, rule: "legacy-name" });
});

test("detects session loss even when the wrapper labeled the trajectory complete", () => {
  const broken = step("snapshot", {}, false);
  broken.toolOutput.error = "Browser session lost (CDP connection closed 1006)";
  const trajectory = {
    task: { id: "done", instruction: "Add widget" },
    steps: [step("run"), broken],
    status: "complete",
    finalAnswer: "Added widget",
    usage: { input_tokens: 0, output_tokens: 0 },
  } satisfies Trajectory;
  expect(executionIssues(trajectory)).toEqual([
    { failureClass: "browser_session_lost", stepIndex: 1, source: "tool-error" },
  ]);
});
