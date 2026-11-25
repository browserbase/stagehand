import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { saveCodexDiagnostic } from "../src/diagnostics.js";
import { isolatedCodexEnv } from "../src/isolation.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 50;
})();

const ASYNC_FC_OPTS =
  process.env.FC_UNSEEDED === "1"
    ? { numRuns: Math.min(NUM_RUNS, 100) }
    : { seed: 202604054, numRuns: Math.min(NUM_RUNS, 40) };

describe("codex isolation and diagnostics formal properties", () => {
  it("strips all inherited CODEX_* keys except CODEX_API_KEY and confines HOME/CODEX_HOME inside cwd", async () => {
    const codexKeyArb = fc
      .stringMatching(/^[A-Z0-9_]{1,16}$/)
      .filter((suffix) => suffix !== "API_KEY" && suffix !== "HOME")
      .map((suffix) => `CODEX_${suffix}`);

    const otherKeyArb = fc
      .stringMatching(/^[A-Z][A-Z0-9_]{1,12}$/)
      .filter((k) => !k.startsWith("CODEX_") && k !== "HOME" && k !== "OPENAI_API_KEY");

    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-prop-"));
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.dictionary(codexKeyArb, fc.string({ maxLength: 30 }), { maxKeys: 6 }),
          fc.dictionary(otherKeyArb, fc.string({ maxLength: 30 }), { maxKeys: 4 }),
          fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
          fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
          fc.boolean(),
          async (codexVars, otherVars, openaiKey, codexApiKey, hasAuthFile) => {
            const iterDir = await fs.mkdtemp(path.join(baseDir, "run-"));
            const origCodexHome = path.join(iterDir, "host-codex");
            const workDir = path.join(iterDir, "eval-cwd");
            await fs.mkdir(origCodexHome, { recursive: true });
            await fs.writeFile(path.join(origCodexHome, "config.toml"), "secret_plugin = true");
            await fs.writeFile(path.join(origCodexHome, "history.jsonl"), '{"prompt":"host"}');
            if (hasAuthFile) {
              await fs.writeFile(path.join(origCodexHome, "auth.json"), '{"token":"fixture"}');
            }

            const sourceEnv: NodeJS.ProcessEnv = {
              ...codexVars,
              ...otherVars,
              HOME: path.join(iterDir, "host-home"),
              CODEX_HOME: origCodexHome,
              ...(openaiKey !== undefined && { OPENAI_API_KEY: openaiKey }),
              ...(codexApiKey !== undefined && { CODEX_API_KEY: codexApiKey }),
            };

            const isolated = await isolatedCodexEnv(workDir, sourceEnv);
            const resolvedWorkDir = path.resolve(workDir);
            const expectedHome = path.join(resolvedWorkDir, "home");
            const expectedCodexHome = path.join(expectedHome, ".codex");

            expect(isolated.HOME).toBe(expectedHome);
            expect(isolated.CODEX_HOME).toBe(expectedCodexHome);
            expect(path.isAbsolute(isolated.HOME)).toBe(true);
            expect(path.isAbsolute(isolated.CODEX_HOME)).toBe(true);
            expect(path.relative(resolvedWorkDir, isolated.CODEX_HOME).startsWith("..")).toBe(
              false,
            );

            for (const key of Object.keys(isolated)) {
              if (key.startsWith("CODEX_")) {
                expect(["CODEX_HOME", "CODEX_API_KEY"]).toContain(key);
              }
            }

            const copiedFiles = await fs.readdir(isolated.CODEX_HOME);
            expect(copiedFiles).not.toContain("config.toml");
            expect(copiedFiles).not.toContain("history.jsonl");
            if (!openaiKey && !codexApiKey && hasAuthFile) {
              expect(copiedFiles).toEqual(["auth.json"]);
              const mode =
                (await fs.stat(path.join(isolated.CODEX_HOME, "auth.json"))).mode & 0o777;
              expect(mode).toBe(0o600);
            } else {
              expect(copiedFiles).toEqual([]);
            }
          },
        ),
        ASYNC_FC_OPTS,
      );
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  it("ignores empty CODEX_HOME string rather than reading ./auth.json from process.cwd()", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-empty-home-"));
    try {
      const fakeHome = path.join(baseDir, "user-home");
      await fs.mkdir(path.join(fakeHome, ".codex"), { recursive: true });
      await fs.writeFile(path.join(fakeHome, ".codex", "auth.json"), '{"from":"home"}');
      const workDir = path.join(baseDir, "eval");

      const isolated = await isolatedCodexEnv(workDir, {
        HOME: fakeHome,
        CODEX_HOME: "",
      });

      expect(await fs.readdir(isolated.CODEX_HOME)).toEqual(["auth.json"]);
      expect(await fs.readFile(path.join(isolated.CODEX_HOME, "auth.json"), "utf8")).toBe(
        '{"from":"home"}',
      );
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  it("saveCodexDiagnostic handles null-prototype objects and redacts secrets cleanly", async () => {
    const secretArb = fc.oneof(
      fc.stringMatching(/^sk-[A-Za-z0-9]{12,24}$/),
      fc.stringMatching(/^bb_live_[A-Za-z0-9]{10,20}$/),
    );
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-diag-prop-"));
    try {
      await fc.assert(
        fc.asyncProperty(
          secretArb,
          fc.integer({ min: 0, max: 10_000 }),
          fc.constantFrom("error", "nullProto", "nullProtoCause", "string"),
          async (secret, count, kind) => {
            let err: unknown;
            if (kind === "error") {
              err = new Error(`Failed with ${secret}`, { cause: `cause ${secret}` });
            } else if (kind === "nullProto") {
              err = Object.assign(Object.create(null), { token: secret });
            } else if (kind === "nullProtoCause") {
              err = new Error(`Failed with ${secret}`, {
                cause: Object.assign(Object.create(null), { detail: secret }),
              });
            } else {
              err = `Raw ${secret}`;
            }

            const file = await saveCodexDiagnostic(baseDir, err, count);
            const raw = await fs.readFile(file, "utf8");
            expect(raw).not.toContain(secret);
            const parsed = JSON.parse(raw) as { eventCount: number; message: string };
            expect(parsed.eventCount).toBe(count);
            expect(typeof parsed.message).toBe("string");
          },
        ),
        ASYNC_FC_OPTS,
      );
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
