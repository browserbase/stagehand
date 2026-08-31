import { describe, expect, it } from "vitest";
import type { CriterionScore, EvaluationResult, TrajectoryStep } from "stagehand-v3";

import {
  applyVerdictGates,
  checkAnswerGrounding,
  extractGroundingDatums,
  isSearchEngineUrl,
  resolveRequireGrounding,
  strictProcessScore,
} from "../../framework/verifierGates.js";

type StepInit = {
  action?: string;
  /** probeEvidence.url after the step. */
  url?: string;
  /** actionArgs.code (a facade `run` call); URLs inside are used as hints. */
  code?: string;
  output?: unknown;
  ok?: boolean;
};

function step({
  action = "stagehand__run",
  url,
  code,
  output = "",
  ok = true,
}: StepInit): TrajectoryStep {
  return {
    actionName: action,
    actionArgs: code ? { code } : {},
    reasoning: "",
    agentEvidence: { modalities: [] },
    probeEvidence: url ? { url } : {},
    toolOutput: { ok, result: output },
  };
}

function criterion(
  name: string,
  earned: number | null,
  max: number,
  explanation = "",
  extra: Partial<CriterionScore> = {},
): CriterionScore {
  return { criterion: name, maxPoints: max, earnedPoints: earned, explanation, ...extra };
}

const passingJudge: EvaluationResult = {
  outcomeSuccess: true,
  processScore: 1,
  perCriterion: [
    criterion("find it", 2, 2, "Found on the page."),
    criterion("report", 1, 1, "Reported."),
  ],
  evidenceInsufficient: [],
};

const isFacadeTool = (name: string) => name.startsWith("stagehand__");

describe("applyVerdictGates — outcome gates", () => {
  const goodSteps = [step({ url: "https://www.example.com/", output: "Total: $18.95" })];

  it("leaves a clean judge pass alone", () => {
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: { steps: goodSteps, status: "complete", finalAnswer: "It costs $18.95." },
      isFacadeTool,
      requireGrounding: true,
    });
    expect(gates.outcomeSuccess).toBe(true);
    expect(gates.judgeOutcomeSuccess).toBe(true);
    expect(gates.outcomeGates).toEqual([]);
  });

  it("gates a pass with an empty final answer", () => {
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: { steps: goodSteps, status: "complete", finalAnswer: "   " },
      requireGrounding: false,
    });
    expect(gates.outcomeSuccess).toBe(false);
    expect(gates.judgeOutcomeSuccess).toBe(true);
    expect(gates.outcomeGates).toEqual(["no_final_answer"]);
  });

  it("gates a pass whose trajectory ended in error", () => {
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: { steps: goodSteps, status: "error", finalAnswer: "done" },
      requireGrounding: false,
    });
    expect(gates.outcomeGates).toEqual(["trajectory_error"]);
    expect(gates.outcomeSuccess).toBe(false);
  });

  it("gates a pass with zero facade tool calls only when a matcher is supplied", () => {
    const trajectory = {
      steps: [step({ action: "web_fetch", output: "price $18.95" })],
      status: "complete" as const,
      finalAnswer: "It costs $18.95.",
    };
    const withMatcher = applyVerdictGates({
      evaluation: passingJudge,
      trajectory,
      isFacadeTool,
      requireGrounding: false,
    });
    expect(withMatcher.outcomeGates).toEqual(["no_browser_use"]);

    const withoutMatcher = applyVerdictGates({
      evaluation: passingJudge,
      trajectory,
      requireGrounding: false,
    });
    expect(withoutMatcher.outcomeGates).toEqual([]);
    expect(withoutMatcher.outcomeSuccess).toBe(true);
  });

  it("gates an answer whose only numbers came from search-engine pages", () => {
    const trajectory = {
      steps: [
        step({
          url: "https://www.google.com/search?q=seat+fee",
          output: "AirAsia standard seat SGD 5 per sector",
        }),
        step({ url: "https://www.airasia.com/flights/", output: "Book flights" }),
      ],
      status: "complete" as const,
      finalAnswer: "A window seat costs SGD 5 per sector.",
    };
    const strict = applyVerdictGates({
      evaluation: passingJudge,
      trajectory,
      requireGrounding: true,
    });
    expect(strict.outcomeGates).toEqual(["ungrounded_answer"]);
    expect(strict.grounding?.ungrounded.map((d) => d.text)).toEqual(["SGD 5"]);
    expect(strict.grounding?.ungrounded[0]?.onlyInSearchEngine).toBe(true);

    const lenient = applyVerdictGates({
      evaluation: passingJudge,
      trajectory,
      requireGrounding: false,
    });
    expect(lenient.outcomeGates).toEqual([]);
    expect(lenient.grounding?.gatesOutcome).toBe(true);
  });

  it("never flips a judge fail and reports no gates for it", () => {
    const gates = applyVerdictGates({
      evaluation: { ...passingJudge, outcomeSuccess: false },
      trajectory: { steps: [], status: "error", finalAnswer: "" },
      isFacadeTool,
      requireGrounding: true,
    });
    expect(gates.outcomeSuccess).toBe(false);
    expect(gates.judgeOutcomeSuccess).toBe(false);
    expect(gates.outcomeGates).toEqual([]);
  });

  it("stacks multiple gates", () => {
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: { steps: goodSteps, status: "error", finalAnswer: "" },
      requireGrounding: true,
    });
    expect(gates.outcomeGates).toEqual(["no_final_answer", "trajectory_error"]);
  });
});

describe("strictProcessScore", () => {
  it("zeroes blocker-credited criteria but keeps them in the denominator", () => {
    const { perCriterion, strict, blockedCriteria } = strictProcessScore({
      perCriterion: [
        criterion("search", 4, 4, "Configured the search with all constraints."),
        criterion(
          "seat cost",
          5,
          5,
          "Due to an uncontrollable platform blocker the seat map was unreachable. Full credit awarded.",
        ),
        criterion("report", 3, 3, "Reported correctly."),
      ],
      evidenceInsufficient: [],
    });
    expect(strict).toBeCloseTo(7 / 12);
    expect(blockedCriteria).toBe(1);
    expect(perCriterion?.[1]?.blocked).toBe(true);
    expect(perCriterion?.[0]?.blocked).toBeUndefined();
  });

  it("does not mark a partially-credited criterion as blocked even if it mentions a blocker", () => {
    const { perCriterion, strict } = strictProcessScore({
      perCriterion: [
        criterion("seat cost", 3, 5, "Blocked midway; partial credit for the attempt."),
      ],
    });
    expect(perCriterion?.[0]?.blocked).toBeUndefined();
    expect(strict).toBeCloseTo(0.6);
  });

  it("zeroes evidenceInsufficient criteria via the flag or the top-level list", () => {
    const { strict, blockedCriteria } = strictProcessScore({
      perCriterion: [
        criterion("a", 2, 2, "ok", { evidenceInsufficient: true }),
        criterion("b", 2, 2, "ok"),
        criterion("c", 2, 2, "ok"),
      ],
      evidenceInsufficient: ["c"],
    });
    expect(blockedCriteria).toBe(2);
    expect(strict).toBeCloseTo(2 / 6);
  });

  it("excludes not-applicable criteria and scores a fully bot-walled run 0", () => {
    const blocked = "Access Denied wall at step 0. Full credit due to uncontrollable blocker.";
    const { strict, blockedCriteria } = strictProcessScore({
      perCriterion: [
        criterion("locate", 2, 2, blocked),
        criterion("add to cart", 3, 3, blocked),
        criterion("conditional", null, 2, "Not applicable."),
      ],
    });
    expect(blockedCriteria).toBe(2);
    expect(strict).toBe(0);
  });

  it("returns undefined without perCriterion", () => {
    expect(strictProcessScore({})).toEqual({
      perCriterion: undefined,
      strict: undefined,
      blockedCriteria: 0,
    });
  });
});

describe("grounding — datum extraction", () => {
  it("extracts currency, percent, time, decimal and long-integer datums as gating", () => {
    const datums = extractGroundingDatums(
      "Costs SGD 5 or $18.95 (12% off), zip 11222, 2.4 miles, lap 1:27:02.624, 3 stops, in 2023.",
    );
    const byText = Object.fromEntries(datums.map((d) => [d.text, d]));
    expect(byText["SGD 5"]).toMatchObject({ kind: "currency", gates: true });
    expect(byText["$18.95"]).toMatchObject({ kind: "currency", gates: true });
    expect(byText["12%"]).toMatchObject({ kind: "percent", gates: true });
    expect(byText["1:27:02.624"]).toMatchObject({ kind: "time", gates: true });
    expect(byText["2.4"]).toMatchObject({ kind: "decimal", gates: true });
    expect(byText["11222"]).toMatchObject({ kind: "integer", gates: true });
    expect(byText["3"]).toMatchObject({ kind: "integer", gates: false });
    expect(byText["2023"]).toMatchObject({ kind: "integer", gates: false });
  });

  it("treats capitalised multi-word entities as advisory", () => {
    const datums = extractGroundingDatums("Max Verstappen won the Abu Dhabi Grand Prix.");
    const entities = datums.filter((d) => d.kind === "entity").map((d) => d.text);
    expect(entities).toContain("Max Verstappen");
    expect(entities).toContain("Abu Dhabi Grand Prix");
    expect(datums.every((d) => d.kind !== "entity" || d.gates === false)).toBe(true);
  });

  it("never gates on a datum echoed from the task instruction", () => {
    const datums = extractGroundingDatums(
      "Under $15: CVS gummies at $8.99.",
      "Find CVS multivitamins under $15",
    );
    const byText = Object.fromEntries(datums.map((d) => [d.text, d]));
    expect(byText["$15"]).toMatchObject({ gates: false, fromInstruction: true });
    expect(byText["$8.99"]).toMatchObject({ gates: true });
  });
});

describe("grounding — matching", () => {
  it("matches currency with alias, spacing and trailing zeros", () => {
    const steps = [step({ url: "https://shop.example.com", output: "Seat fee: S$ 5.00 each" })];
    const result = checkAnswerGrounding("SGD 5 per sector", steps);
    expect(result?.ungrounded).toEqual([]);
    expect(result?.checked[0]?.groundedAtStep).toBe(0);
  });

  it("matches numbers regardless of thousands separators and case", () => {
    const steps = [step({ url: "https://data.example.com", output: "POPULATION: 8336817 (est.)" })];
    expect(checkAnswerGrounding("about 8,336,817 people", steps)?.gatesOutcome).toBe(false);
  });

  it("does not let a currency amount match inside a longer number", () => {
    const steps = [step({ url: "https://shop.example.com", output: "Total $118.95" })];
    expect(checkAnswerGrounding("costs $18.95", steps)?.gatesOutcome).toBe(true);
  });

  it("carries the page URL forward to steps without a hint", () => {
    const steps = [
      step({ code: "await page.goto('https://www.google.com/search?q=x')", output: "results" }),
      step({ action: "stagehand__snapshot", output: "AI Overview: the fee is $42.50" }),
    ];
    const result = checkAnswerGrounding("fee is $42.50", steps);
    expect(result?.gatesOutcome).toBe(true);
    expect(result?.ungrounded[0]?.onlyInSearchEngine).toBe(true);
  });

  it("prefers the probe URL over URLs mentioned in the code or output", () => {
    const steps = [
      step({
        url: "https://www.target-site.com/results",
        code: "await page.goto('https://www.google.com/search?q=x'); await page.click('a')",
        output: "target-site result: $42.50",
      }),
    ];
    expect(checkAnswerGrounding("fee is $42.50", steps)?.gatesOutcome).toBe(false);
  });

  it("does not gate when the headline datum is grounded but a secondary one is not", () => {
    const steps = [step({ url: "https://www.ups.com/rates", output: "Medium box from $18.95" })];
    const result = checkAnswerGrounding("UPS medium: $18.95. FedEx is around $24.35.", steps);
    expect(result?.groundedNumeric).toBe(1);
    expect(result?.ungroundedNumeric).toBe(1);
    expect(result?.gatesOutcome).toBe(false);
  });

  it("returns undefined when the answer has nothing to check", () => {
    expect(checkAnswerGrounding("done", [])).toBeUndefined();
  });

  it("does not gate an answer with only entity datums", () => {
    const result = checkAnswerGrounding("Canyonlands National Park", []);
    expect(result?.gatesOutcome).toBe(false);
    expect(result?.ungrounded).toHaveLength(1);
  });

  it("classifies search-engine hosts by domain, including subdomains", () => {
    expect(isSearchEngineUrl("https://www.google.com/search?q=a")).toBe(true);
    expect(isSearchEngineUrl("https://html.duckduckgo.com/html/?q=a")).toBe(true);
    expect(isSearchEngineUrl("https://www.scribd.com/doc/1")).toBe(true);
    expect(isSearchEngineUrl("https://old.reddit.com/r/x")).toBe(true);
    expect(isSearchEngineUrl("https://www.googleapis-mirror.example.com/")).toBe(false);
    expect(isSearchEngineUrl("https://www.airasia.com/")).toBe(false);
    expect(isSearchEngineUrl(undefined)).toBe(false);
  });
});

describe("scoringIncomplete", () => {
  it("flags a rubric with more items than judged criteria without touching the outcome", () => {
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: {
        steps: [step({ url: "https://www.example.com", output: "$18.95" })],
        status: "complete",
        finalAnswer: "$18.95",
      },
      requireGrounding: true,
      rubricItemCount: 3,
    });
    expect(gates.scoringIncomplete).toBe(true);
    expect(gates.outcomeSuccess).toBe(true);
  });

  it("is false when counts match or no rubric count is known", () => {
    const base = {
      evaluation: passingJudge,
      trajectory: { steps: [] as TrajectoryStep[], status: "complete" as const, finalAnswer: "ok" },
      requireGrounding: false,
    };
    expect(applyVerdictGates({ ...base, rubricItemCount: 2 }).scoringIncomplete).toBe(false);
    expect(applyVerdictGates(base).scoringIncomplete).toBe(false);
  });
});

describe("resolveRequireGrounding", () => {
  it("honours the env override in both directions", () => {
    expect(resolveRequireGrounding("hardbenchmark", true, { EVAL_REQUIRE_GROUNDING: "0" })).toBe(
      false,
    );
    expect(resolveRequireGrounding("custom", false, { EVAL_REQUIRE_GROUNDING: "1" })).toBe(true);
  });

  it("is advisory by default and gates only with EVAL_REQUIRE_GROUNDING=1", () => {
    expect(resolveRequireGrounding("hardbenchmark", false, {})).toBe(false);
    expect(resolveRequireGrounding("custom", true, {})).toBe(false);
    expect(resolveRequireGrounding("hardbenchmark", true, { EVAL_REQUIRE_GROUNDING: "1" })).toBe(
      true,
    );
    expect(resolveRequireGrounding("hardbenchmark", true, { EVAL_REQUIRE_GROUNDING: "0" })).toBe(
      false,
    );
  });
});

/**
 * Minimal excerpts of the audited HardBench rows (2026-08-31, gpt-5.6-luna).
 * Each keeps only the fields the gates read; toolOutput text is trimmed to the
 * fragment that carried the datum.
 */
describe("evidence rows from the 2026-08-31 audit", () => {
  it("deepagents 7e6993f2 (imgur meme): pass with status=error and no answer is gated", () => {
    const evaluation: EvaluationResult = {
      outcomeSuccess: true,
      processScore: 1,
      perCriterion: [
        criterion("Include a frog as the background image", 3, 3, "Frog head as background."),
        criterion('Add the exact text "Enjoy your life"', 3, 3, "Text added, centered."),
        criterion('Ensure "Enjoy your life" is the only text on the meme', 2, 2, "No other text."),
        criterion("Present the created meme", 2, 2, "Presented on the editor canvas."),
      ],
      evidenceInsufficient: [],
    };
    const steps = Array.from({ length: 51 }, () =>
      step({
        action: "stagehand.snapshot",
        url: "https://imgur.com/",
        output: "[3-5] RootWebArea: Imgur: The magic of the Internet",
      }),
    );
    const gates = applyVerdictGates({
      evaluation,
      trajectory: { steps, status: "error", finalAnswer: "" },
      isFacadeTool: (name) => name.startsWith("stagehand."),
      requireGrounding: true,
      rubricItemCount: 4,
    });
    expect(gates.judgeOutcomeSuccess).toBe(true);
    expect(gates.outcomeSuccess).toBe(false);
    expect(gates.outcomeGates).toEqual(["no_final_answer", "trajectory_error"]);
    expect(gates.processScoreStrict).toBe(1);
    expect(gates.grounding).toBeUndefined();
  });

  it("eve airasia_88: SGD 5 lifted from Google snippets is gated; blocker credit zeroed", () => {
    const evaluation: EvaluationResult = {
      outcomeSuccess: true,
      processScore: 11 / 12,
      perCriterion: [
        criterion(
          "Search for AirAsia flights with the correct constraints",
          4,
          4,
          "Configured the search on AirAsia with all required constraints.",
        ),
        criterion(
          "Determine window-seat selection cost for the matching itinerary",
          4,
          5,
          "Due to an uncontrollable blocker on the results page the agent could not reach the seat map. However, it resolved the fee via search.",
        ),
        criterion(
          "Report unavailability if no matching direct AirAsia flights",
          3,
          3,
          "Not applicable because direct flights exist; full points awarded per instructions.",
        ),
      ],
      evidenceInsufficient: [],
    };
    const steps = [
      step({
        code: "await page.goto('https://www.google.com/search?q=AirAsia+Singapore+to+Langkawi+booking')",
        url: "https://www.google.com/search?q=AirAsia+Singapore+to+Langkawi+booking",
        output:
          "airasia.com › flights AirAsia standard seat from SGD 5 ... https://www.airasia.com",
      }),
      step({
        code: "await page.goto('https://www.airasia.com/flights/')",
        url: "https://www.airasia.com/flights/",
        output: "One-way Round-trip Singapore Changi Airport Langkawi 24/11/2026 27/11/2026",
      }),
      step({
        url: "https://www.airasia.com/v2/flights/search/?origin=SIN&destination=LGK",
        output: "Loading flights ... (skeleton)",
      }),
      step({
        code: "await page.goto('https://www.google.com/search?q=AirAsia+seat+selection+window+seat+fee+Singapore')",
        url: "https://www.google.com/search?q=AirAsia+seat+selection+window+seat+fee+Singapore",
        output: "Standard seat (window/aisle) SGD 5 – SGD 10 per sector · support.airasia.com",
      }),
      step({
        url: "https://www.google.com/search?q=%22International+Route+-+Seat+(AK)%22",
        output: "scribd.com › document AirAsia fee schedule: Standard Seat SGD 5 ...",
      }),
    ];
    const gates = applyVerdictGates({
      evaluation,
      trajectory: {
        task: {
          instruction:
            "How much does it cost to select a window seat on a direct AirAsia flight from Singapore to Langkawi from November 24 to November 27? If there are no available flights for those dates, please indicate that in your answer",
        },
        steps,
        status: "complete",
        finalAnswer:
          "A standard window seat costs SGD 5 per passenger per sector. For the round trip from Singapore to Langkawi (Nov 24–27, 2026), selecting a window seat for both flights costs SGD 10 total. Direct flights are available.",
      },
      isFacadeTool,
      requireGrounding: true,
      rubricItemCount: 3,
    });
    expect(gates.judgeOutcomeSuccess).toBe(true);
    expect(gates.outcomeGates).toEqual(["ungrounded_answer"]);
    expect(gates.outcomeSuccess).toBe(false);
    const ungrounded = gates.grounding?.ungrounded.filter((d) => d.kind === "currency");
    expect(ungrounded?.map((d) => d.text)).toEqual(["SGD 5", "SGD 10"]);
    expect(ungrounded?.every((d) => d.onlyInSearchEngine)).toBe(true);
    // "2026" and "24"/"27" are grounded on airasia.com but must not rescue
    // the row: years and short integers never count as grounded numerics.
    expect(gates.grounding?.groundedNumeric).toBe(0);
    // 4/5 on the blocker criterion is partial credit, not the full-credit
    // blocker rule, so the strict score matches the judge here.
    expect(gates.processScoreStrict).toBeCloseTo(11 / 12);
    expect(gates.processScoreLenient).toBeCloseTo(11 / 12);
  });

  it("eve afcebfed (CVS gluten-free): grounded on cvs.com, not gated", () => {
    const evaluation: EvaluationResult = {
      outcomeSuccess: true,
      processScore: 1,
      perCriterion: [
        criterion("Identify multivitamins", 2, 2, "Searched 'gluten free multivitamin'."),
        criterion("Apply 'gluten-free' filter or identify attribute", 2, 2, "Search term applied."),
        criterion("Apply 'CVS Health Brand' filter or identify brand", 2, 2, "Checked CVS brand."),
        criterion("Apply price filter 'under $15'", 2, 2, "Checked $5-$10 and $10-$15."),
        criterion("Sort or identify by 'most reviewed'", 3, 3, "Sorted by Most Reviewed."),
        criterion("Report the identified product", 3, 3, "Reported the top product."),
      ],
      evidenceInsufficient: [],
    };
    const steps = [
      step({
        code: "await page.goto('https://www.cvs.com/')",
        url: "https://www.cvs.com/",
        output: "CVS",
      }),
      step({
        url: "https://www.cvs.com/search?searchTerm=gluten%20free%20multivitamin",
        output:
          "CVS Women's Daily Multivitamin Gummies, 150 CT $8.99 (280) · CVS Men 50+ Advanced Multivitamin Tablets, 65 CT $9.39 (246) · CVS Women's Multivitamin Tablets, 120 CT $13.49 (243)",
      }),
    ];
    const gates = applyVerdictGates({
      evaluation,
      trajectory: {
        task: {
          instruction:
            "Find the most reviewed gluten-free CVS Health Brand multivitamin under $15 on cvs.com",
        },
        steps,
        status: "complete",
        finalAnswer:
          "Most-reviewed matches: 1) CVS Women’s Daily Multivitamin Gummies, 150 CT — $8.99, 280 reviews; 2) CVS Men 50+ Advanced Multivitamin Tablets, 65 CT — $9.39, 246 reviews; 3) CVS Women’s Multivitamin Tablets, 120 CT — $13.49, 243 reviews.",
      },
      isFacadeTool,
      requireGrounding: true,
      rubricItemCount: 6,
    });
    // Constraint leaks (gluten-free never verified) are the judge's job; the
    // deterministic gates have nothing to say about this row.
    expect(gates.outcomeSuccess).toBe(true);
    expect(gates.outcomeGates).toEqual([]);
    expect(gates.grounding?.groundedNumeric).toBeGreaterThan(0);
    expect(gates.grounding?.ungroundedNumeric).toBe(0);
    expect(gates.processScoreStrict).toBe(1);
    expect(gates.scoringIncomplete).toBe(false);
  });

  it("a0a18ca6 (Macy's bot wall): processScore 1.0 becomes 0 strict", () => {
    const blocked = (what: string) =>
      `${what} was impossible due to the uncontrollable platform blocker; full process credit is awarded.`;
    const evaluation: EvaluationResult = {
      outcomeSuccess: false,
      processScore: 1,
      perCriterion: [
        criterion(
          "Locate a men's T-shirt",
          2,
          2,
          "Blocked immediately by Macy's anti-bot ('Access Denied').",
        ),
        criterion("Select 'large' size for the T-shirt", 2, 2, blocked("Selecting the size")),
        criterion(
          "Apply 'stripe pattern' filter for the T-shirt",
          2,
          2,
          blocked("Applying the filter"),
        ),
        criterion(
          "Apply 'short sleeve' filter for the T-shirt",
          2,
          2,
          blocked("Applying the filter"),
        ),
        criterion("Select a T-shirt from the 'Best Sellers' group", 2, 2, blocked("Selecting")),
        criterion("Add the selected T-shirt to the cart", 3, 3, blocked("Adding to cart")),
        criterion(
          "Respect Critical Point boundaries",
          2,
          2,
          "Did not cross any transactional boundary as it was blocked from entering the website.",
        ),
      ],
      evidenceInsufficient: [],
    };
    const gates = applyVerdictGates({
      evaluation,
      trajectory: {
        steps: [step({ url: "https://www.macys.com/", output: "Access Denied" })],
        status: "complete",
        finalAnswer: "Unable to complete the task because Macy’s blocked access.",
      },
      isFacadeTool,
      requireGrounding: true,
    });
    expect(gates.processScoreLenient).toBe(1);
    expect(gates.processScoreStrict).toBe(0);
    expect(gates.blockedCriteria).toBe(7);
    expect(gates.perCriterion?.every((c) => c.blocked)).toBe(true);
    expect(gates.outcomeSuccess).toBe(false);
  });

  it("mastra 864244b6 (F1): race time seen on espn.com after search detours is grounded", () => {
    const steps = [
      step({
        action: "stagehand_run",
        code: "await page.goto('https://www.bing.com/search?q=2023+Abu+Dhabi+Grand+Prix+race+time')",
        url: "https://www.bing.com/search?q=2023+Abu+Dhabi+Grand+Prix+race+time",
        output: '{"title": "2023 Abu Dhabi Grand Prix race time 1:27:02.624 - Search"}',
      }),
      step({
        action: "stagehand_run",
        code: "await page.goto('https://www.espn.com/f1/results/_/id/600026790')",
        url: "https://www.espn.com/f1/results/_/id/600026790",
        output:
          "Etihad Airways Abu Dhabi GP November 24 - November 26, 2023 Yas Marina Circuit RACE WINNER Max Verstappen 1:27:02.624 2 Pits",
      }),
    ];
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: {
        steps,
        status: "complete",
        finalAnswer: "Max Verstappen won first place with a race time of 1:27:02.624.",
      },
      isFacadeTool: (name) => name === "stagehand_run",
      requireGrounding: true,
    });
    expect(gates.outcomeSuccess).toBe(true);
    expect(gates.outcomeGates).toEqual([]);
    expect(gates.grounding?.checked.find((d) => d.kind === "time")?.groundedAtStep).toBe(1);
  });

  it("the same answer with the time only in a Google snippet is gated", () => {
    const steps = [
      step({
        url: "https://www.google.com/search?q=ESPN+2023+Abu+Dhabi+Grand+Prix+results",
        output:
          "ESPN https://www.espn.com › race 2023 Etihad Airways Abu Dhabi Grand Prix F1, won by Max Verstappen. Winner VER 1:27:02.624",
      }),
      step({ url: "https://www.espn.com/f1/", output: "F1 home — schedule, standings" }),
    ];
    const gates = applyVerdictGates({
      evaluation: passingJudge,
      trajectory: {
        steps,
        status: "complete",
        finalAnswer: "Max Verstappen won the 2023 Abu Dhabi Grand Prix in 1:27:02.624.",
      },
      requireGrounding: true,
    });
    expect(gates.outcomeGates).toEqual(["ungrounded_answer"]);
  });
});
