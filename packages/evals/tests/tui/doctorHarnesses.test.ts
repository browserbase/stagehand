import { describe, expect, it, vi } from "vitest";
import {
  buildHarnessMatrix,
  harnessMatrixReasons,
  readMaxOldSpaceMb,
  type HarnessProbeOptions,
} from "../../tui/commands/doctorHarnesses.js";
import type { ConfigFile } from "../../tui/commands/config.js";

const baseConfig = (overrides: Partial<ConfigFile> = {}): ConfigFile => ({
  version: 2,
  defaults: { env: "local", concurrency: 3 },
  benchmarks: {},
  ...overrides,
});

function fetchStub(routes: Record<string, number>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const status = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1] ?? 200;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

const allResolvable = () => true;
const noBinaries = (): string | undefined => undefined;

function options(overrides: Partial<HarnessProbeOptions> = {}): HarnessProbeOptions {
  return {
    config: baseConfig(),
    env: {},
    resolvePackage: allResolvable,
    which: noBinaries,
    execArgv: [],
    envReport: { files: [], sources: new Map(), shadowed: [] },
    ...overrides,
  };
}

describe("buildHarnessMatrix", () => {
  it("builds one row per executable harness, skipping fx and cursor", async () => {
    const matrix = await buildHarnessMatrix(options());
    expect(matrix.harnesses.map((row) => row.harness)).toEqual([
      "stagehand",
      "claude_code",
      "codex",
      "mastra",
      "pi",
      "eve",
      "deepagents",
    ]);
    expect(matrix.skipped).toEqual(["fx", "cursor"]);
    const cursor = await buildHarnessMatrix(options({ requested: ["cursor", "codex"] }));
    expect(cursor.harnesses.map((row) => row.harness)).toEqual(["codex"]);
    expect(cursor.skipped).toEqual(["cursor"]);
  });

  it("reports missing keys and binaries with the exact fix, without network", async () => {
    const matrix = await buildHarnessMatrix(
      options({
        env: { OPENAI_API_KEY: "sk" },
        resolvePackage: (specifier) => specifier !== "@anthropic-ai/claude-agent-sdk",
        requested: ["claude_code", "codex", "deepagents"],
      }),
    );
    const byName = Object.fromEntries(matrix.harnesses.map((row) => [row.harness, row]));

    expect(byName.claude_code.required).toBe(true);
    expect(byName.claude_code.binary).toMatchObject({ status: "fail", fix: "pnpm install" });
    expect(byName.claude_code.key).toMatchObject({ status: "fail", label: "ANTHROPIC_API_KEY" });
    expect(byName.claude_code.key.fix).toMatch(/add ANTHROPIC_API_KEY to .*\.env/);
    expect(byName.claude_code.probe.status).toBe("skipped");
    // Values never leak into the report.
    expect(JSON.stringify(matrix)).not.toContain('"value"');

    expect(byName.codex.binary).toMatchObject({ status: "ok", label: "vendored" });
    expect(byName.codex.key).toMatchObject({ status: "ok", label: "OPENAI_API_KEY" });
    expect(byName.codex.extra).toMatchObject({ status: "ok", label: "CODEX_HOME writable" });

    expect(byName.deepagents.binary).toMatchObject({ status: "fail", label: "uv missing" });
    expect(byName.deepagents.binary.fix).toContain("astral.sh/uv/install.sh");
    expect(byName.deepagents.extra.fix).toBe(
      "uv sync --locked --project packages/integrations/deepagents-sdk/runner",
    );

    const reasons = harnessMatrixReasons(matrix);
    expect(reasons.failures).toEqual([
      expect.stringContaining(
        "claude_code: @anthropic-ai/claude-agent-sdk not resolvable. → pnpm install",
      ),
      expect.stringContaining("claude_code: ANTHROPIC_API_KEY is not set"),
      expect.stringContaining("deepagents: uv is not on PATH"),
      // requested → verifier + browserbase rows count too
      expect.stringContaining("verifier: GOOGLE_GENERATIVE_AI_API_KEY is not set"),
    ]);
  });

  it("does not let unrequested harnesses or a quiet environment move the verdict", async () => {
    const matrix = await buildHarnessMatrix(options({ env: { OPENAI_API_KEY: "sk" } }));
    expect(matrix.harnesses.find((row) => row.harness === "claude_code")?.key.status).toBe("fail");
    expect(harnessMatrixReasons(matrix)).toEqual({ failures: [], warnings: [] });
  });

  it("treats defaults.harness as requested", async () => {
    const matrix = await buildHarnessMatrix(
      options({ config: baseConfig({ defaults: { harness: "eve", concurrency: 3 } }), env: {} }),
    );
    expect(matrix.harnesses.find((row) => row.harness === "eve")?.required).toBe(true);
    expect(harnessMatrixReasons(matrix).failures[0]).toContain("eve: OPENAI_API_KEY is not set");
  });

  it("--probe validates each provider key once and classifies 401 as a dead key with the .env line", async () => {
    const fetchImpl = fetchStub({
      "https://api.anthropic.com": 401,
      "https://api.openai.com": 200,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash": 200,
    });
    const envFile = `${process.cwd()}/tests/fixtures/doctor.env`;
    const matrix = await buildHarnessMatrix(
      options({
        probe: true,
        fetchImpl,
        env: {
          OPENAI_API_KEY: "sk",
          ANTHROPIC_API_KEY: "bad",
          GOOGLE_GENERATIVE_AI_API_KEY: "g",
          BROWSERBASE_API_KEY: "bb",
          BROWSERBASE_PROJECT_ID: "proj",
        },
        envReport: {
          files: [{ kind: "package", path: envFile, loaded: true, applied: ["ANTHROPIC_API_KEY"] }],
          sources: new Map([["ANTHROPIC_API_KEY", "package"]]),
          shadowed: [],
        },
        requested: ["claude_code", "codex", "mastra"],
      }),
    );
    const byName = Object.fromEntries(matrix.harnesses.map((row) => [row.harness, row]));
    expect(byName.claude_code.probe).toMatchObject({ status: "fail", label: "401" });
    expect(byName.claude_code.probe.fix).toContain(`replace ANTHROPIC_API_KEY in ${envFile}`);
    expect(byName.codex.probe).toMatchObject({ status: "ok", label: "200" });
    expect(byName.mastra.probe).toMatchObject({ status: "ok", label: "200" });
    // openai probed once for codex + mastra, anthropic once, google once (judge), browserbase once
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(calls.filter((url) => url.startsWith("https://api.openai.com"))).toHaveLength(1);
    expect(calls.filter((url) => url.startsWith("https://api.anthropic.com"))).toHaveLength(1);
    expect(
      calls.filter((url) => url.startsWith("https://api.browserbase.com/v1/projects/proj")),
    ).toHaveLength(1);
    expect(matrix.verifier.probes[1]).toMatchObject({ status: "ok", label: "200" });
    expect(matrix.browserbase.probes[1]).toMatchObject({ status: "ok", label: "200" });
    expect(harnessMatrixReasons(matrix).failures).toEqual([
      expect.stringContaining("claude_code: key rejected by the provider"),
    ]);
  });

  it("flags a retired judge model with the config command that fixes it", async () => {
    const matrix = await buildHarnessMatrix(
      options({
        probe: true,
        fetchImpl: fetchStub({
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash": 404,
        }),
        env: { GOOGLE_GENERATIVE_AI_API_KEY: "g", EVAL_VERIFIER_MODEL: "google/gemini-2.5-flash" },
        requested: ["stagehand"],
      }),
    );
    expect(matrix.verifier.detail).toBe("google/gemini-2.5-flash (EVAL_VERIFIER_MODEL)");
    expect(matrix.verifier.probes[1]).toMatchObject({
      status: "fail",
      label: "model not found",
      fix: "evals config verifier set model google/gemini-3.5-flash",
    });
    expect(matrix.verifier.probes[1].detail).toContain("Fused judgment call failed");
  });

  it("warns about the heap for in-process harnesses at concurrency ≥ 5", async () => {
    const low = await buildHarnessMatrix(
      options({ env: { OPENAI_API_KEY: "sk" }, concurrency: 4 }),
    );
    expect(low.harnesses.find((row) => row.harness === "mastra")?.extra).toMatchObject({
      status: "ok",
      label: "heap n/a at concurrency 3",
    });

    // -c 10 alone doesn't reach 5 in-process sessions: openai defaults to 3 wide.
    const capped = await buildHarnessMatrix(
      options({
        env: { OPENAI_API_KEY: "sk", NODE_OPTIONS: "--max-old-space-size=4096" },
        concurrency: 10,
      }),
    );
    expect(capped.harnesses.find((row) => row.harness === "pi")?.extra).toMatchObject({
      status: "ok",
      label: "heap n/a at concurrency 3",
    });

    const high = await buildHarnessMatrix(
      options({
        env: {
          OPENAI_API_KEY: "sk",
          NODE_OPTIONS: "--max-old-space-size=4096",
          EVAL_PROVIDER_CONCURRENCY: "openai=5",
        },
        concurrency: 10,
      }),
    );
    expect(high.harnesses.find((row) => row.harness === "pi")?.extra).toMatchObject({
      status: "warn",
      label: "heap 4096 MB < 12288 at concurrency 5",
      fix: "export NODE_OPTIONS=--max-old-space-size=12288",
    });

    const ok = await buildHarnessMatrix(
      options({
        config: baseConfig({
          defaults: { concurrency: 8 },
          providers: { openai: { concurrency: 8 } },
        }),
        env: { OPENAI_API_KEY: "sk" },
        execArgv: ["--max-old-space-size=16384"],
        concurrency: 8,
      }),
    );
    expect(ok.harnesses.find((row) => row.harness === "pi")?.extra).toMatchObject({
      status: "ok",
      label: "heap 16384 MB",
    });
  });

  it("does not warn about CI when VERIFIER_PERSIST_TRAJECTORIES keeps trajectories on", async () => {
    const matrix = await buildHarnessMatrix(
      options({ env: { CI: "1", VERIFIER_PERSIST_TRAJECTORIES: "1" } }),
    );
    expect(matrix.environment.ci).toEqual({ set: false });
  });

  it("surfaces env-file provenance, shadowed keys and CI in the environment report", async () => {
    const matrix = await buildHarnessMatrix(
      options({
        env: { CI: "1" },
        envReport: {
          files: [
            {
              kind: "package",
              path: "/repo/packages/evals/.env",
              loaded: true,
              applied: ["A", "B"],
            },
            { kind: "cwd", path: "/repo/.env", loaded: false, applied: [] },
          ],
          sources: new Map([["A", "package"]]),
          shadowed: [{ name: "OPENAI_API_KEY", file: "/repo/packages/evals/.env", by: "shell" }],
        },
      }),
    );
    expect(matrix.environment).toEqual({
      files: [
        { kind: "package", path: "/repo/packages/evals/.env", loaded: true, applied: 2 },
        { kind: "cwd", path: "/repo/.env", loaded: false, applied: 0 },
      ],
      shadowed: [{ name: "OPENAI_API_KEY", file: "/repo/packages/evals/.env", by: "shell" }],
      ci: { set: true, fix: "unset CI, or VERIFIER_PERSIST_TRAJECTORIES=1" },
      status: "warn",
    });
    expect(harnessMatrixReasons(matrix).warnings).toEqual([
      "OPENAI_API_KEY differs between shell export and /repo/packages/evals/.env; shell export wins",
    ]);
  });
});

describe("readMaxOldSpaceMb", () => {
  it("reads the last flag from NODE_OPTIONS or execArgv", () => {
    expect(readMaxOldSpaceMb({}, [])).toBeUndefined();
    expect(readMaxOldSpaceMb({ NODE_OPTIONS: "--max-old-space-size=8192 --no-warnings" }, [])).toBe(
      8192,
    );
    expect(
      readMaxOldSpaceMb({ NODE_OPTIONS: "--max-old-space-size=8192" }, [
        "--max-old-space-size=12288",
      ]),
    ).toBe(12288);
  });
});
