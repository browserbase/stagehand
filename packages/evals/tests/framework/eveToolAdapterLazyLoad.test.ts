import { expect, it, vi } from "vitest";

vi.mock("@browserbasehq/stagehand-integrations-eve-sdk", () => {
  throw new Error("eve-sdk must not load while importing the harness registry");
});

it("imports the benchmark harness registry without loading eve-sdk", async () => {
  vi.resetModules();

  const { listBenchHarnesses } = await import("../../framework/benchHarness.js");

  expect(listBenchHarnesses()).toContain("eve");
});
