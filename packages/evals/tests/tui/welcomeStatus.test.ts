import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  snapshotEnv,
  renderInlineWarning,
  hasZeroProviderKeys,
  __resetPackageEnvCacheForTests,
} from "../../tui/welcomeStatus.js";

const PROVIDER_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "BB_API_KEY",
  "BB_PROJECT_ID",
  "BRAINTRUST_API_KEY",
];

const savedEnv: Record<string, string | undefined> = {};
let savedDisablePkgEnv: string | undefined;

function clearProviderKeys(): void {
  for (const key of PROVIDER_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Neutralize the package-local .env loader so tests don't depend on
  // whatever real keys the developer happens to have at packages/evals/.env.
  savedDisablePkgEnv = process.env.EVALS_DISABLE_PACKAGE_ENV;
  process.env.EVALS_DISABLE_PACKAGE_ENV = "1";
  __resetPackageEnvCacheForTests();
}

function restoreProviderKeys(): void {
  for (const key of PROVIDER_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (savedDisablePkgEnv === undefined) {
    delete process.env.EVALS_DISABLE_PACKAGE_ENV;
  } else {
    process.env.EVALS_DISABLE_PACKAGE_ENV = savedDisablePkgEnv;
  }
  __resetPackageEnvCacheForTests();
}

describe("snapshotEnv", () => {
  beforeEach(() => clearProviderKeys());
  afterEach(() => restoreProviderKeys());

  it("reports all missing when no provider keys are set", () => {
    const s = snapshotEnv();
    expect(s.openai.state).toBe("missing");
    expect(s.anthropic.state).toBe("missing");
    expect(s.google.state).toBe("missing");
    expect(s.browserbase.apiKey).toBe("missing");
    expect(s.browserbase.projectId).toBe("missing");
    expect(s.braintrust.state).toBe("missing");
  });

  it("detects OpenAI from process.env with the right source", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.openai.state).toBe("set");
    expect(s.openai.source).toBe("process-env");
  });

  it("prefers GOOGLE_GENERATIVE_AI_API_KEY over GEMINI_API_KEY", () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-test";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.google.state).toBe("set");
    expect(s.google.var).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  it("falls back to GEMINI_API_KEY when canonical is missing", () => {
    process.env.GEMINI_API_KEY = "gemini-only";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.google.state).toBe("set");
    expect(s.google.var).toBe("GEMINI_API_KEY");
  });

  it("treats BB_* alias keys as set with viaAlias=true", () => {
    process.env.BB_API_KEY = "bb-key";
    process.env.BB_PROJECT_ID = "bb-proj";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.browserbase.apiKey).toBe("set");
    expect(s.browserbase.projectId).toBe("set");
    expect(s.browserbase.viaAlias).toBe(true);
  });

  it("does not flag viaAlias when canonical BB names are present", () => {
    process.env.BROWSERBASE_API_KEY = "bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "bb-proj";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.browserbase.viaAlias).toBe(false);
  });

  it("does NOT flag viaAlias when canonical + alias are mixed (one of each)", () => {
    // viaAlias should mean "all present BB values are alias-only". If the
    // user set BROWSERBASE_API_KEY (canonical) AND BB_PROJECT_ID (alias),
    // the dim "(via BB_API_KEY)" hint would be misleading — suppress it.
    process.env.BROWSERBASE_API_KEY = "bb-key";
    process.env.BB_PROJECT_ID = "bb-proj";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.browserbase.apiKey).toBe("set");
    expect(s.browserbase.projectId).toBe("set");
    expect(s.browserbase.viaAlias).toBe(false);
  });

  it("flags viaAlias when only one BB var is present and it came via alias", () => {
    process.env.BB_API_KEY = "bb-key";
    // BROWSERBASE_PROJECT_ID intentionally absent
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.browserbase.apiKey).toBe("set");
    expect(s.browserbase.projectId).toBe("missing");
    expect(s.browserbase.viaAlias).toBe(true);
  });

  it("partial BB — one of two vars set", () => {
    process.env.BROWSERBASE_API_KEY = "bb-key";
    __resetPackageEnvCacheForTests();
    const s = snapshotEnv();
    expect(s.browserbase.apiKey).toBe("set");
    expect(s.browserbase.projectId).toBe("missing");
  });
});

describe("hasZeroProviderKeys", () => {
  beforeEach(() => clearProviderKeys());
  afterEach(() => restoreProviderKeys());

  it("true when all three providers missing", () => {
    expect(hasZeroProviderKeys(snapshotEnv())).toBe(true);
  });

  it("false with only OpenAI set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    __resetPackageEnvCacheForTests();
    expect(hasZeroProviderKeys(snapshotEnv())).toBe(false);
  });

  it("false with only Anthropic set", () => {
    process.env.ANTHROPIC_API_KEY = "ak-test";
    __resetPackageEnvCacheForTests();
    expect(hasZeroProviderKeys(snapshotEnv())).toBe(false);
  });

  it("false with only Google set (via GEMINI_API_KEY)", () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    __resetPackageEnvCacheForTests();
    expect(hasZeroProviderKeys(snapshotEnv())).toBe(false);
  });
});

describe("renderInlineWarning", () => {
  beforeEach(() => clearProviderKeys());
  afterEach(() => restoreProviderKeys());

  it("returns a non-null warning when zero provider keys", () => {
    const out = renderInlineWarning(snapshotEnv());
    expect(out).not.toBeNull();
    // Strip ANSI for substring match.
    // eslint-disable-next-line no-control-regex
    const plain = (out ?? "").replace(/\[[0-9;]*m/g, "");
    expect(plain).toContain("No provider API key found");
    expect(plain).toContain("evals doctor");
  });

  it("returns null when at least one provider key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    __resetPackageEnvCacheForTests();
    expect(renderInlineWarning(snapshotEnv())).toBeNull();
  });

  it("returns null even when Braintrust+BB are missing but a provider is set", () => {
    process.env.ANTHROPIC_API_KEY = "ak-test";
    __resetPackageEnvCacheForTests();
    expect(renderInlineWarning(snapshotEnv())).toBeNull();
  });
});
