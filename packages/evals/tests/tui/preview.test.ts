import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPreview } from "../../tui/preview.js";

function basePayload(
  runOptions: Record<string, unknown>,
): Record<string, unknown> {
  return {
    target: "b:webtailbench",
    normalizedTarget: "b:webtailbench",
    tasks: ["wtb-1"],
    skippedTasks: [],
    envOverrides: {},
    runOptions,
    matrix: [],
  };
}

function renderedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.join(" ")).join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderPreview header", () => {
  it("shows the selected skill mode next to the harness", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderPreview(
      basePayload({
        environment: "LOCAL",
        concurrency: 1,
        trials: 1,
        harness: "vercel_ai_sdk",
        skillMode: "prompt_show",
      }),
    );
    const output = renderedText(spy);
    expect(output).toContain("Harness:");
    expect(output).toContain("vercel_ai_sdk");
    expect(output).toContain("Skill mode:");
    expect(output).toContain("prompt_show");
  });

  it("omits the skill-mode bit when no mode is planned", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderPreview(
      basePayload({
        environment: "LOCAL",
        concurrency: 1,
        trials: 1,
        harness: "stagehand",
        skillMode: null,
      }),
    );
    expect(renderedText(spy)).not.toContain("Skill mode:");
  });
});
