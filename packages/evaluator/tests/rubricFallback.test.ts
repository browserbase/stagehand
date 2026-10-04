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
