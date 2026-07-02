import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";

// Keep the real @browserbasehq/stagehand surface (loadApiKeyFromEnv,
// providerEnvVarMap, etc. — the credential-resolution logic under test depends
// on them) but replace V3 with a lightweight stub so the config-building path
// never touches real LLM-provider/browser internals. buildClaudeCodeVerifierConfig
// only uses the V3 instance as an inert LLM-client carrier.
vi.mock("@browserbasehq/stagehand", async () => {
  const actual = await vi.importActual<
    typeof import("@browserbasehq/stagehand")
  >("@browserbasehq/stagehand");
  return {
    ...actual,
    V3: class {
      opts: unknown;
      constructor(opts: unknown) {
        this.opts = opts;
      }
    },
  };
});

// Mock the execute()-path collaborators so we can assert the fail-fast +
// finally(cleanup) contract without spawning a real Claude Code agent.
// vi.hoisted keeps these usable inside the hoisted vi.mock factories below.
const { cleanupMock, runClaudeCodeAgentMock } = vi.hoisted(() => ({
  cleanupMock: vi.fn(async () => {}),
  runClaudeCodeAgentMock: vi.fn(async () => ({}) as never),
}));

vi.mock("../../framework/claudeCodeToolAdapter.js", () => ({
  prepareClaudeCodeToolAdapter: vi.fn(async () => ({ cleanup: cleanupMock })),
}));

vi.mock("../../framework/claudeCodeRunner.js", () => ({
  runClaudeCodeAgent: runClaudeCodeAgentMock,
}));

vi.mock("../../framework/externalHarnessPlan.js", () => ({
  buildExternalHarnessTaskPlan: vi.fn(
    (): ExternalHarnessTaskPlan => ({
      dataset: "webvoyager",
      taskId: "wv-1",
      startUrl: "https://example.com",
      instruction: "Find the checkout button",
    }),
  ),
}));

import {
  buildClaudeCodeVerifierConfig,
  claudeCodeHarness,
} from "../../framework/benchHarness.js";
import { EvalLogger } from "../../logger.js";
import { EvalsError } from "../../errors.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

// Env keys the verifier-config credential resolution reads. Snapshot + restore
// so tests don't leak state into each other or the rest of the suite.
const MANAGED_ENV = [
  "EVAL_CLAUDE_CODE_VERIFIER",
  "EVAL_CLAUDE_CODE_VERIFIER_MODEL",
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "OLLAMA_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of MANAGED_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  cleanupMock.mockClear();
  runClaudeCodeAgentMock.mockClear();
});

afterEach(() => {
  for (const key of MANAGED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("buildClaudeCodeVerifierConfig judge credentials", () => {
  it("builds a config for a keyless provider override (ollama) without an apiKey", () => {
    process.env.EVAL_CLAUDE_CODE_VERIFIER_MODEL = "ollama/llama3";

    const config = buildClaudeCodeVerifierConfig(plan, new EvalLogger(false));

    expect(config).toBeDefined();
    expect(config?.judgeModel).toBe("ollama/llama3");
    // Keyless provider → no explicit apiKey is threaded through.
    expect(config?.judgeClientOptions).toBeUndefined();
  });

  it("resolves AI_GATEWAY_API_KEY for a gateway/ judge override", () => {
    process.env.AI_GATEWAY_API_KEY = "gw-test-key";
    process.env.EVAL_CLAUDE_CODE_VERIFIER_MODEL =
      "gateway/anthropic/claude-sonnet-4-20250514";

    const config = buildClaudeCodeVerifierConfig(plan, new EvalLogger(false));

    expect(config).toBeDefined();
    expect(config?.judgeModel).toBe(
      "gateway/anthropic/claude-sonnet-4-20250514",
    );
    expect(config?.judgeClientOptions).toEqual({ apiKey: "gw-test-key" });
  });

  it("fail-fasts when a gateway/ judge override is missing AI_GATEWAY_API_KEY", () => {
    process.env.EVAL_CLAUDE_CODE_VERIFIER_MODEL = "gateway/some-model";

    expect(() =>
      buildClaudeCodeVerifierConfig(plan, new EvalLogger(false)),
    ).toThrow(/AI_GATEWAY_API_KEY|no API key resolved/);
  });
});

describe("claudeCodeHarness.execute verifier fail-fast", () => {
  const makeExecuteInput = () => ({
    task: {} as never,
    input: { modelName: "anthropic/claude-sonnet-4-20250514" } as never,
    row: {
      config: {
        harness: "claude_code" as const,
        model: "anthropic/claude-sonnet-4-20250514" as never,
        environment: "LOCAL" as const,
        useApi: false,
      },
    } as never,
    logger: new EvalLogger(false),
  });

  it("throws the config error but still runs toolAdapter.cleanup() (fail-fast inside try/finally)", async () => {
    // Anthropic judge override with ANTHROPIC_API_KEY unset (cleared in beforeEach)
    // → verifier config must throw, and the prepared adapter must still be cleaned up.
    process.env.EVAL_CLAUDE_CODE_VERIFIER_MODEL =
      "anthropic/claude-sonnet-4-20250514";

    await expect(claudeCodeHarness.execute(makeExecuteInput())).rejects.toThrow(
      EvalsError,
    );

    // The verifier construction was moved inside the try, so the finally that
    // owns the adapter runs even when config resolution throws.
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    // The agent must NOT have run — we failed fast before executing.
    expect(runClaudeCodeAgentMock).not.toHaveBeenCalled();
  });
});
