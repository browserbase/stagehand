import { describe, expect, it } from "vitest";
import { derivePlan } from "../../tui/welcome/detect.js";
import { welcomeEnabled } from "../../tui/welcome/index.js";
import { upsertEnv } from "../../tui/commands/setup.js";
import { loadScriptedCases } from "../../tui/welcome/agentScript.js";

describe("welcomeEnabled", () => {
  it("accepts the usual truthy spellings", () => {
    expect(welcomeEnabled("1")).toBe(true);
    expect(welcomeEnabled("true")).toBe(true);
    expect(welcomeEnabled(" YES ")).toBe(true);
  });
  it("is off when unset, empty, or anything else", () => {
    expect(welcomeEnabled(undefined)).toBe(false);
    expect(welcomeEnabled("")).toBe(false);
    expect(welcomeEnabled("0")).toBe(false);
    expect(welcomeEnabled("a")).toBe(false);
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
    expect(recommend.command).toBe("run b:webvoyager -l 3 --harness claude_code -e local");
  });
  it("prefers local Chrome, but uses Browserbase when Chrome is absent", () => {
    const { plan, recommend } = derivePlan({
      chrome: false,
      browserbase: true,
      providers: ["openai"],
    });
    expect(plan.kind).toBe("real");
    if (plan.kind === "real") expect(plan.browser).toBe("browserbase");
    expect(recommend.command).toBe("run b:webvoyager -l 3 --harness codex -e browserbase");
  });
  it("is scripted without a key, and says what is missing", () => {
    const noKey = derivePlan({ chrome: true, browserbase: true, providers: [] });
    expect(noKey.plan.kind).toBe("scripted");
    expect(noKey.recommend.command).toBe("setup");
    expect(noKey.recommend.line).toMatch(/ANTHROPIC_API_KEY or OPENAI_API_KEY/);
    const noBrowser = derivePlan({ chrome: false, browserbase: false, providers: ["anthropic"] });
    expect(noBrowser.plan.kind).toBe("scripted");
    expect(noBrowser.recommend.line).toMatch(/browser/i);
    const googleOnly = derivePlan({ chrome: true, browserbase: false, providers: ["google"] });
    expect(googleOnly.plan.kind).toBe("scripted");
    expect(googleOnly.recommend.line).toMatch(/claude_code or codex/);
  });
});

describe("upsertEnv", () => {
  it("appends new keys and rewrites existing ones, preserving everything else", () => {
    const body = "# keys\nOPENAI_API_KEY=old\nOTHER=1\n";
    const out = upsertEnv(body, { OPENAI_API_KEY: "new", BROWSERBASE_API_KEY: "bb" });
    expect(out).toBe("# keys\nOPENAI_API_KEY=new\nOTHER=1\nBROWSERBASE_API_KEY=bb\n");
  });
  it("handles an empty file and `export`-prefixed lines", () => {
    expect(upsertEnv("", { A: "1" })).toBe("A=1\n");
    expect(upsertEnv("export A=0\n", { A: "1" })).toBe("A=1\n");
  });
});

describe("loadScriptedCases", () => {
  it("returns the Amazon WebVoyager case with a full observe → act → answer trajectory", () => {
    const [cs] = loadScriptedCases();
    expect(cs.id).toBe("Amazon--4");
    expect(cs.task.length).toBeGreaterThan(20);
    expect(cs.steps[0].kind).toBe("goto");
    expect(cs.steps[cs.steps.length - 1].kind).toBe("answer");
    expect(cs.steps.some((s) => s.kind === "observe")).toBe(true);
  });
});
