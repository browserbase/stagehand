import { expect, test } from "vitest";
import { detectRubricFallbacks, describeRubricFallbacks } from "../src/rubricFallback.js";

const rubric = {
  items: [
    {
      criterion: "Use Overstock as the shopping platform",
      maxPoints: 2,
      description:
        "Attempt to search for the sink on Overstock. Full credit if the agent successfully accesses Overstock and begins the product search there, OR if Overstock is inaccessible (e.g., site error, CAPTCHA/login wall/geo-block) and the agent clearly reports the blocker. Partial credit if the agent uses another site.",
    },
    {
      criterion: "Advance the ordering flow",
      maxPoints: 4,
      description:
        "Proceed up to a safe stopping point. Full credit also if add-to-cart/checkout is impossible due to uncontrollable platform limitations (e.g., out of stock, forced login, technical error) and the agent clearly reports the issue and where it occurred.",
    },
    {
      criterion: "Report the price",
      maxPoints: 1,
      description: "Full credit if the exact price is reported.",
    },
  ],
};

test("detects rubric fallback clauses and ignores ordinary full-credit criteria", () => {
  const found = detectRubricFallbacks(rubric);
  expect(found.map((f) => f.criterion)).toEqual([
    "Use Overstock as the shopping platform",
    "Advance the ordering flow",
  ]);
  expect(found[1].clause).toMatch(/out of stock/);
  expect(describeRubricFallbacks({ items: [rubric.items[2]] })).toBe("");
  expect(describeRubricFallbacks(rubric)).toContain("unachievable_fallback_accepted");
});

test("a condition in a negated branch is not surfaced as a fallback", () => {
  const item = (description: string) => ({
    items: [{ criterion: "Model", maxPoints: 1, description }],
  });
  expect(
    detectRubricFallbacks(
      item("Full credit if the exact model is found, not if no exact match is available."),
    ),
  ).toEqual([]);
  // "unless" in a penalty clause is the fallback allowance itself, so it stays surfaced.
  expect(
    detectRubricFallbacks(
      item("Partial credit if the agent uses another site without trying X, unless X is blocked."),
    ),
  ).toHaveLength(1);
  // An affirmative branch alongside a negated one still counts.
  expect(
    detectRubricFallbacks(
      item(
        "Full credit if the exact model is found, or if no exact match exists and the agent names the closest alternative, not if it guesses.",
      ),
    ),
  ).toHaveLength(1);
});
