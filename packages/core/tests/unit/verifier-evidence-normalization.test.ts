import { describe, expect, it } from "vitest";

import { buildAgentEvidenceFromStepFinished } from "../../lib/v3/verifier/evidenceNormalization.js";

describe("buildAgentEvidenceFromStepFinished", () => {
  it("captures primitive tool results as text evidence", () => {
    const evidence = buildAgentEvidenceFromStepFinished({
      type: "step_finished",
      stepIndex: 0,
      actionName: "check",
      actionArgs: {},
      reasoning: "",
      toolOutput: { ok: true, result: false },
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
    });

    expect(evidence.modalities).toEqual([{ type: "text", content: "false" }]);
  });
});
