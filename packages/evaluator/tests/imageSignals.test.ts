import { expect, test } from "vitest";
import { scoreImages, selectSignalImages } from "../src/imageSignals.js";
import type { Trajectory } from "../src/types.js";

const step = (url: string, actionName: string, args: object, result: string) => ({
  actionName,
  actionArgs: args,
  reasoning: "",
  agentEvidence: { modalities: [] },
  probeEvidence: { url },
  toolOutput: { ok: true, result },
});
const t = {
  task: { id: "x", instruction: "Book 2 adults" },
  steps: [
    step(
      "https://s/home",
      "stagehand.run",
      { code: "await page.goto('https://s/home')" },
      "x".repeat(500),
    ),
    step(
      "https://s/search",
      "stagehand.run",
      { code: "await page.getByRole('textbox').fill('E450')" },
      "undefined",
    ),
    step("https://s/search", "stagehand.snapshot", {}, "y".repeat(800)),
    step("https://s/search", "stagehand.snapshot", {}, "y".repeat(800)),
    step(
      "https://s/item",
      "stagehand.run",
      { code: "return document.body.innerText" },
      "Price $16.50 " + "z".repeat(600),
    ),
  ],
  status: "complete",
  finalAnswer: "$16.50",
  usage: { input_tokens: 0, output_tokens: 0 },
} as unknown as Trajectory;
const images = [0, 1, 2, 3, 4].map((s) => ({ canonicalIndex: 100 + s, originalStepIndex: s }));

test("signals favour anchored, state-changing and page-entry frames", () => {
  const scored = scoreImages({ trajectory: t, images, anchorSteps: [4], retrievalSteps: [], k: 3 });
  const by = Object.fromEntries(scored.map((s) => [s.originalStepIndex, s.reasons]));
  expect(by[4]).toContain("anchor");
  expect(by[1]).toContain("state-change");
  expect(by[1]).toContain("new-page");
  expect(by[0]).toContain("new-page");
});

test("selection is budgeted, drops adjacent same-page duplicates, and is chronological", () => {
  const picked = selectSignalImages({
    trajectory: t,
    images,
    anchorSteps: [4],
    retrievalSteps: [],
    k: 3,
  });
  expect(picked.length).toBe(3);
  expect(picked).toEqual([...picked].sort((a, b) => a - b));
  expect(picked).toContain(104);
  expect(picked).toContain(101);
});
