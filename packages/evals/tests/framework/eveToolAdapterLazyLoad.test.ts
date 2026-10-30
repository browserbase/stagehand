import { expect, it, vi } from "vitest";

vi.mock("@browserbasehq/stagehand-integrations-eve", () => {
  throw new Error("the eve harness driver must not load while importing the harness registry");
});

it("imports the benchmark harness registry without loading the eve harness driver", async () => {
  vi.resetModules();

  const { listBenchHarnesses } = await import("../../framework/benchHarness.js");

  expect(listBenchHarnesses()).toContain("eve");
});
