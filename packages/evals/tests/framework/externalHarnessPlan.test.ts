import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { buildExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";

const modelName = "anthropic/claude-sonnet-4-20250514" as AvailableModel;

describe("buildExternalHarnessTaskPlan", () => {
  it("builds WebVoyager plans", () => {
    expect(
      buildExternalHarnessTaskPlan({
        name: "agent/webvoyager",
        modelName,
        params: {
          id: "wv-1",
          web: "https://example.com",
          ques: "Find the checkout button",
        },
      }),
    ).toEqual({
      dataset: "webvoyager",
      taskId: "wv-1",
      startUrl: "https://example.com",
      instruction: "Find the checkout button",
    });
  });

  it("builds OnlineMind2Web plans", () => {
    expect(
      buildExternalHarnessTaskPlan({
        name: "agent/onlineMind2Web",
        modelName,
        params: {
          task_id: "m2w-1",
          website: "https://example.com",
          confirmed_task: "Open account settings",
        },
      }),
    ).toMatchObject({
      dataset: "onlineMind2Web",
      taskId: "m2w-1",
      startUrl: "https://example.com",
      instruction: "Open account settings",
    });
  });

  it("builds WebTailBench plans with a default start URL", () => {
    expect(
      buildExternalHarnessTaskPlan({
        name: "agent/webtailbench",
        modelName,
        params: {
          id: "wtb-1",
          ques: "Find the latest pricing page",
        },
      }),
    ).toMatchObject({
      dataset: "webtailbench",
      taskId: "wtb-1",
      startUrl: "https://www.google.com",
      instruction: "Find the latest pricing page",
    });
  });

  it("rejects unsupported external harness tasks", () => {
    expect(() =>
      buildExternalHarnessTaskPlan({
        name: "agent/gaia",
        modelName,
        params: {},
      }),
    ).toThrow(/not supported yet/);
  });
});
