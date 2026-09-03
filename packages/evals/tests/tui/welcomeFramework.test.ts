import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../tui/format.js";
import { derivePlan } from "../../tui/welcome/detect.js";
import { LEADERBOARD, renderLeaderboard } from "../../tui/welcome/leaderboard.js";
import { DEFAULT_VARIANT, isWelcomeVariant, variantFromEnv } from "../../tui/welcome/index.js";

describe("variantFromEnv", () => {
  it("maps truthy opt-in values to the default variant", () => {
    expect(variantFromEnv("1")).toBe(DEFAULT_VARIANT);
    expect(variantFromEnv("true")).toBe(DEFAULT_VARIANT);
  });
  it("selects an explicit variant letter, case-insensitively", () => {
    expect(variantFromEnv("a")).toBe("a");
    expect(variantFromEnv("C")).toBe("c");
  });
  it("returns null for unset or unknown values", () => {
    expect(variantFromEnv(undefined)).toBeNull();
    expect(variantFromEnv("")).toBeNull();
    expect(variantFromEnv("zzz")).toBeNull();
  });
  it("isWelcomeVariant guards the five letters", () => {
    expect(isWelcomeVariant("c")).toBe(true);
    expect(isWelcomeVariant("d")).toBe(false);
    expect(isWelcomeVariant("e")).toBe(false);
    expect(isWelcomeVariant(1)).toBe(false);
  });
});

describe("derivePlan", () => {
  it("is real when a provider key and a browser both exist", () => {
    const { plan, recommend } = derivePlan({
      chrome: true,
      browserbase: false,
      providers: ["anthropic"],
    });
    expect(plan.kind).toBe("real");
    if (plan.kind === "real") expect(plan.browser).toBe("local");
    expect(recommend.command).toBe("run b:webvoyager -l 3");
  });
  it("prefers local Chrome, but uses Browserbase when Chrome is absent", () => {
    const { plan, recommend } = derivePlan({
      chrome: false,
      browserbase: true,
      providers: ["openai"],
    });
    expect(plan.kind).toBe("real");
    if (plan.kind === "real") expect(plan.browser).toBe("browserbase");
    expect(recommend.command).toBe("run b:webvoyager -l 3 -e browserbase");
  });
  it("is scripted without a key, and says what is missing", () => {
    const noKey = derivePlan({ chrome: true, browserbase: true, providers: [] });
    expect(noKey.plan.kind).toBe("scripted");
    expect(noKey.recommend.command).toBe("list bench");
    expect(noKey.recommend.line).toMatch(/OPENAI_API_KEY/);
    const noBrowser = derivePlan({ chrome: false, browserbase: false, providers: ["google"] });
    expect(noBrowser.plan.kind).toBe("scripted");
    expect(noBrowser.recommend.line).toMatch(/browser/i);
  });
});

describe("renderLeaderboard", () => {
  it("renders every public row inside a panel with the benchmark title", () => {
    const lines = renderLeaderboard({}).map(stripAnsi);
    expect(lines[0]).toContain("Browserbase Benchmark v1");
    for (const row of LEADERBOARD) {
      expect(lines.some((l) => l.includes(row.model))).toBe(true);
    }
  });
  it("keeps every row the same visible width (no jagged borders)", () => {
    const widths = new Set(
      renderLeaderboard({
        yourRow: { label: "you · navigation/open", accuracy: 100, speedS: 2.1, costUsd: 0 },
      }).map((l) => stripAnsi(l).length),
    );
    expect(widths.size).toBe(1);
  });
  it("scales the user's row independently of the public rows", () => {
    const half = renderLeaderboard({
      progress: 1,
      yourProgress: 0.5,
      yourRow: { label: "you", accuracy: 100, speedS: 2, costUsd: 0 },
    }).map(stripAnsi);
    expect(half.some((l) => l.includes("92.1%"))).toBe(true); // public rows fully counted
    expect(half.some((l) => l.includes("you") && l.includes("50.0%"))).toBe(true);
  });
});
