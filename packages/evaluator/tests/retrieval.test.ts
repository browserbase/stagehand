import { expect, test } from "vitest";
import { collectCanonicalEvidence } from "../src/evidence.js";
import { chunkText, imageKey, retrieveText, renderRetrievedEvidence } from "../src/retrieval.js";
import type { Trajectory } from "../src/types.js";

test("finds a labeled value deep in a 100KB batch without clipping the selected span", async () => {
  const output =
    "unrelated padding ".repeat(7000) +
    "\nOrchid widget warranty: 60000 miles, price $215.99\n" +
    "padding ".repeat(4000);
  const trajectory = {
    task: {
      id: "deep",
      instruction: "Find Orchid warranty",
      precomputedRubric: {
        items: [
          {
            criterion: "Orchid warranty",
            description: "Find warranty mileage and price of Orchid widget",
            maxPoints: 1,
          },
        ],
      },
    },
    steps: [
      {
        actionName: "run",
        actionArgs: {},
        reasoning: "",
        agentEvidence: { modalities: [] },
        probeEvidence: {},
        toolOutput: { ok: true, result: output },
      },
    ],
    finalObservation: { url: "https://example.test" },
    status: "complete",
    finalAnswer: "60000 miles, $215.99",
    usage: { input_tokens: 0, output_tokens: 0 },
  } satisfies Trajectory;
  const { evidence } = await collectCanonicalEvidence(trajectory, { chunked: true });
  const selected = retrieveText(
    evidence,
    trajectory.task.precomputedRubric,
    trajectory.finalAnswer,
    3000,
  );
  expect(
    selected.selected.some((e) => e.content.includes("60000 miles") && e.startOffset! > 100000),
  ).toBe(true);
  expect(renderRetrievedEvidence(evidence, selected.groups)).toContain("price $215.99");
  expect(selected.selectedChars).toBeLessThanOrEqual(12000);
});

test("retains opposing values and chronology instead of only answer matches", () => {
  const evidence = ["Orchid warranty is 60000 miles", "Orchid warranty is 30000 miles"].map(
    (content, i) => ({
      canonicalIndex: i,
      originalStepIndex: i,
      source: "tool-output" as const,
      content,
    }),
  );
  const selected = retrieveText(
    evidence,
    { items: [{ criterion: "Orchid warranty", description: "Warranty mileage", maxPoints: 1 }] },
    "60000 miles",
    1000,
  );
  expect(selected.selected.map((e) => e.originalStepIndex)).toEqual([0, 1]);
});

test("retrieves warranty length encoded in a descriptive filename", () => {
  const evidence = [
    ...Array.from({ length: 30 }, () => "Limited warranty documents, no duration supplied"),
    "Download: https://manufacturer.test/assets/ACME-1-Year-Limited-Warranty.pdf",
  ].map((content, i) => ({
    canonicalIndex: i,
    originalStepIndex: i,
    source: "tool-output" as const,
    content,
  }));
  const selected = retrieveText(
    evidence,
    {
      items: [
        { criterion: "ACME limited warranty", description: "Record warranty length", maxPoints: 1 },
      ],
    },
    "1 year",
    100,
  );
  expect(selected.selected.some((e) => e.content.includes("1-Year-Limited-Warranty.pdf"))).toBe(
    true,
  );
});

test("chunk overlap preserves boundary context and hashes distinguish equal-prefix images", () => {
  const input = "a".repeat(1995) + "LABEL $13.99" + "b".repeat(2000);
  expect(chunkText(input).some((c) => c.content.includes("LABEL $13.99"))).toBe(true);
  expect(imageKey(Buffer.from("x".repeat(32) + "a"))).not.toBe(
    imageKey(Buffer.from("x".repeat(32) + "b")),
  );
});

test("default chunked retrieval uses 24k tokens and preserves batched mutation arguments", async () => {
  const { resolveVerifierConfig } = await import("../src/rubricVerifier.js");
  const config = resolveVerifierConfig({});
  expect(config.evidenceTokenBudget).toBe(24000);
  expect(resolveVerifierConfig({}, { evidenceMode: "legacy" }).evidenceTokenBudget).toBe(3000);
  const trajectory = {
    task: { id: "checkout", instruction: "Stop before personal details" },
    steps: [
      {
        actionName: "mcp",
        actionArgs: {
          providerIdentifier: "stagehand",
          actions: [{ op: "fill", id: "email", value: "invented@example.test" }],
        },
        reasoning: "",
        agentEvidence: { modalities: [] },
        probeEvidence: {},
        toolOutput: { ok: true, result: "done" },
      },
    ],
    status: "complete",
    usage: { input_tokens: 0, output_tokens: 0 },
  } satisfies Trajectory;
  const { evidence } = await collectCanonicalEvidence(trajectory, { chunked: true });
  const selected = retrieveText(
    evidence,
    {
      items: [
        { criterion: "checkout", description: "Stop before contact information", maxPoints: 1 },
      ],
    },
    "Done",
    config.evidenceTokenBudget,
  );
  expect(renderRetrievedEvidence(evidence, selected.groups)).toContain("invented@example.test");
});

test("answer anchors force-include the chunk holding a claimed exact quote and report unlocated claims", async () => {
  const page =
    "Life Extension Vegan Vitamin D3 product page\n" +
    "filler line about shipping and reviews\n".repeat(120) +
    "Supplement Facts Serving Size: 1 Vegan Capsule\tAmount Per Serving\tVitamin D3 (as cholecalciferol from algae)\t125 mcg\n";
  const trajectory = {
    task: {
      id: "anchors",
      instruction: "Report the vegan sourcing phrase and price",
      precomputedRubric: {
        items: [
          {
            criterion: "Vegan sourcing",
            description: "Confirm plant sourcing phrase on the product page",
            maxPoints: 1,
          },
          { criterion: "Price", description: "Report the one-time price", maxPoints: 1 },
        ],
      },
    },
    steps: [
      {
        actionName: "run",
        actionArgs: {},
        reasoning: 'I saw "cholecalciferol from algae" and $99.99',
        agentEvidence: { modalities: [] },
        probeEvidence: {},
        toolOutput: { ok: true, result: page },
      },
    ],
    finalObservation: { url: "https://example.test" },
    status: "complete",
    finalAnswer:
      'Confirming phrase: "Vitamin D3 (as cholecalciferol from algae)". Price $99.99. SKU LE-1713.',
    usage: { input_tokens: 0, output_tokens: 0 },
  } satisfies Trajectory;
  const { evidence } = await collectCanonicalEvidence(trajectory, { chunked: true });
  const r = retrieveText(evidence, trajectory.task.precomputedRubric, trajectory.finalAnswer, 3000);
  const quote = r.anchors.find((a) => a.kind === "quote");
  expect(quote?.found.length).toBeGreaterThan(0);
  expect(r.selected.some((e) => e.content.includes("cholecalciferol from algae"))).toBe(true);
  // $99.99 appears only in the agent's own reasoning, never in an observation → reported as not found
  const money = r.anchors.find((a) => a.kind === "money");
  expect(money?.phrase).toBe("$99.99");
  expect(money?.found).toEqual([]);
  const rendered = renderRetrievedEvidence(evidence, r.groups, r.anchors);
  expect(rendered).toContain("NOT FOUND in any recorded observation: $99.99");
  expect(rendered).toContain("Answer-anchor evidence");
});

test("money anchors keep full amounts with and without thousands separators", async () => {
  const { extractAnchors } = await import("../src/retrieval.js");
  const phrases = extractAnchors("Totals: $1200.00, $1,200.00, $16.50 and €999")
    .filter((a) => a.kind === "money")
    .map((a) => a.phrase);
  expect(phrases).toEqual(["$1200.00", "$1,200.00", "$16.50", "€999"]);
});

test("agent text that reproduces the tool result is tagged as an observation and anchor-scannable", async () => {
  const page = "Supplement Facts\nVitamin D3 (as cholecalciferol from algae)\t125 mcg";
  const trajectory = {
    task: {
      id: "tag",
      instruction: "Quote the sourcing phrase",
      precomputedRubric: {
        items: [{ criterion: "Sourcing", description: "sourcing phrase", maxPoints: 1 }],
      },
    },
    steps: [
      {
        actionName: "stagehand.run",
        actionArgs: {},
        reasoning: "reading page",
        agentEvidence: {
          modalities: [
            { type: "text", content: page },
            { type: "text", content: "I think the phrase is about lichen" },
          ],
        },
        probeEvidence: {},
        toolOutput: { ok: true, result: page },
      },
    ],
    finalObservation: { url: "https://example.test" },
    status: "complete",
    finalAnswer: 'Phrase: "cholecalciferol from algae"',
    usage: { input_tokens: 0, output_tokens: 0 },
  } satisfies Trajectory;
  const { evidence } = await collectCanonicalEvidence(trajectory, { chunked: true });
  const texts = evidence.filter((e): e is Extract<typeof e, { content: string }> => "content" in e);
  expect(texts.find((e) => e.content.includes("Supplement Facts"))?.source).toBe("tool-output");
  expect(texts.find((e) => e.content.includes("I think"))?.source).toBe("agent-text");
  const r = retrieveText(evidence, trajectory.task.precomputedRubric, trajectory.finalAnswer, 3000);
  expect(r.anchors.find((a) => a.kind === "quote")?.found.length).toBeGreaterThan(0);
});
