import { describe, expect, it } from "vitest";
import { formatVerdictLine } from "../../tui/commands/verify.js";

// eslint-disable-next-line no-control-regex
const plain = (value: string) => value.replace(/\[[0-9;]*m/g, "");

describe("evals verify verdict line", () => {
  it("shows the gated outcome first and names the gates when they flipped the judge", () => {
    const line = plain(
      formatVerdictLine({
        outcomeSuccess: false,
        judgeOutcomeSuccess: true,
        outcomeGates: ["no_final_answer", "trajectory_error"],
        processScore: 0.5,
        processScoreLenient: 0.75,
      }),
    );
    expect(line).toContain("outcomeSuccess=false");
    expect(line).toContain("judge=true gated=no_final_answer,trajectory_error");
    expect(line).toContain("processScore=0.500 (lenient=0.750)");
  });

  it("still reports the judge verdict when nothing was gated", () => {
    const line = plain(
      formatVerdictLine({
        outcomeSuccess: true,
        judgeOutcomeSuccess: true,
        outcomeGates: [],
        processScore: undefined,
        processScoreLenient: undefined,
      }),
    );
    expect(line).toContain("outcomeSuccess=true  judge=true");
    expect(line).toContain("processScore=n/a (lenient=n/a)");
  });
});
