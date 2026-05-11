import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDoctor } from "../../tui/commands/doctor.js";
import { __resetPackageEnvCacheForTests } from "../../tui/welcomeStatus.js";

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
const tempDirs: string[] = [];
let savedDisablePkgEnv: string | undefined;

type DoctorJsonReport = {
  verdict: string;
  reasons: string[];
  [key: string]: unknown;
};

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

function makeTempEntryDir(defaults?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-doctor-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "evals.config.json"),
    JSON.stringify(
      { defaults: defaults ?? { env: "local", trials: 3 }, benchmarks: {} },
      null,
      2,
    ),
  );
  return dir;
}

async function runDoctorJson(
  entryDir: string,
): Promise<{ exit: number; report: DoctorJsonReport }> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      chunks.push(
        args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
    });
  let exit: number;
  try {
    exit = await handleDoctor(["--json"], entryDir);
  } finally {
    spy.mockRestore();
  }
  const out = chunks.join("\n");
  return { exit, report: JSON.parse(out) as DoctorJsonReport };
}

beforeEach(() => clearProviderKeys());
afterEach(() => {
  restoreProviderKeys();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("handleDoctor --json", () => {
  it("always exits 0 even on fail verdict", async () => {
    const entryDir = makeTempEntryDir();
    const { exit, report } = await runDoctorJson(entryDir);
    expect(exit).toBe(0);
    expect(report.verdict).toBe("fail"); // zero provider keys
  });

  it("emits the full schema (verdict, runtime, config, discovery, keys, reasons)", async () => {
    const entryDir = makeTempEntryDir();
    const { report } = await runDoctorJson(entryDir);
    expect(report).toHaveProperty("verdict");
    expect(report).toHaveProperty("runtime.node");
    expect(report).toHaveProperty("runtime.mode");
    expect(report).toHaveProperty("config.path");
    expect(report).toHaveProperty("config.env");
    expect(report).toHaveProperty("discovery.ok");
    expect(report).toHaveProperty("keys.openai.state");
    expect(report).toHaveProperty("keys.browserbase.apiKey");
    expect(Array.isArray(report.reasons)).toBe(true);
  });
});

describe("handleDoctor verdicts", () => {
  it("fail — zero provider keys", async () => {
    const entryDir = makeTempEntryDir();
    const { report } = await runDoctorJson(entryDir);
    expect(report.verdict).toBe("fail");
    expect(report.reasons.join(" ")).toMatch(/No provider API key/);
  });

  it("fail — env=browserbase with both BB vars missing", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    __resetPackageEnvCacheForTests();
    const entryDir = makeTempEntryDir({ env: "browserbase", trials: 3 });
    const { report } = await runDoctorJson(entryDir);
    expect(report.verdict).toBe("fail");
    expect(report.reasons.join(" ")).toMatch(/env=browserbase/);
  });

  it("warn — provider key present but Braintrust missing", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    __resetPackageEnvCacheForTests();
    const entryDir = makeTempEntryDir({ env: "local", trials: 3 });
    const { report } = await runDoctorJson(entryDir);
    expect(report.verdict).toBe("warn");
    expect(report.reasons.join(" ")).toMatch(/BRAINTRUST_API_KEY missing/);
  });

  it("warn — Browserbase partially configured", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.BRAINTRUST_API_KEY = "bt-test";
    process.env.BROWSERBASE_API_KEY = "bb-test";
    __resetPackageEnvCacheForTests();
    const entryDir = makeTempEntryDir({ env: "local", trials: 3 });
    const { report } = await runDoctorJson(entryDir);
    expect(report.verdict).toBe("warn");
    expect(report.reasons.join(" ")).toMatch(/Browserbase is partially/);
  });

  it("ok — provider + Braintrust set, no BB needed (env=local)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.BRAINTRUST_API_KEY = "bt-test";
    __resetPackageEnvCacheForTests();
    const entryDir = makeTempEntryDir({ env: "local", trials: 3 });
    const { report } = await runDoctorJson(entryDir);
    expect(report.verdict).toBe("ok");
    expect(report.reasons).toEqual([]);
  });
});

describe("handleDoctor exit code", () => {
  it("returns 1 on fail (human output)", async () => {
    const entryDir = makeTempEntryDir();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = await handleDoctor([], entryDir);
    spy.mockRestore();
    expect(exit).toBe(1);
  });

  it("returns 0 on ok (human output)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.BRAINTRUST_API_KEY = "bt-test";
    __resetPackageEnvCacheForTests();
    const entryDir = makeTempEntryDir({ env: "local", trials: 3 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = await handleDoctor([], entryDir);
    spy.mockRestore();
    expect(exit).toBe(0);
  });
});

describe("handleDoctor --help", () => {
  it("prints help and exits 0 on --help", async () => {
    const entryDir = makeTempEntryDir();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = await handleDoctor(["--help"], entryDir);
    // Capture before restore — vitest's mockRestore wipes mock.calls
    const text = spy.mock.calls.flat().join("\n");
    spy.mockRestore();
    expect(exit).toBe(0);
    expect(text).toContain("evals doctor");
    // Hidden flag should NOT appear in help
    expect(text).not.toContain("--probe");
  });

  it("prints help and exits 0 on -h", async () => {
    const entryDir = makeTempEntryDir();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = await handleDoctor(["-h"], entryDir);
    spy.mockRestore();
    expect(exit).toBe(0);
  });
});
