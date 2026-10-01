import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetEvalsEnvForTests, loadEvalsEnv, resolveEnvFiles } from "../evalsEnv.js";

const dirs: string[] = [];
function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-env-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

afterEach(() => {
  __resetEvalsEnvForTests();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadEvalsEnv", () => {
  it("loads the cwd file first (it wins), then the package file, never overriding the shell", () => {
    const root = tmp({
      "pkg/.env": "OPENAI_API_KEY=pkg-openai\nSHARED=pkg\nONLY_PKG=1\n",
      "cwd/.env": "OPENAI_API_KEY=cwd-openai\nSHARED=cwd\nONLY_CWD=1\n",
    });
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "shell-openai" };
    const report = loadEvalsEnv({
      packageRoot: path.join(root, "pkg"),
      cwd: path.join(root, "cwd"),
      env,
    });

    expect(env).toEqual({
      OPENAI_API_KEY: "shell-openai",
      SHARED: "cwd",
      ONLY_CWD: "1",
      ONLY_PKG: "1",
    });
    expect(report.files.map((f) => [f.kind, f.loaded, f.applied])).toEqual([
      ["cwd", true, ["SHARED", "ONLY_CWD"]],
      ["package", true, ["ONLY_PKG"]],
    ]);
    expect(report.sources.get("SHARED")).toBe("cwd");
    expect(report.sources.get("ONLY_PKG")).toBe("package");
    expect(report.sources.has("OPENAI_API_KEY")).toBe(false);
    // Names only — never values.
    expect(report.shadowed).toEqual([
      { name: "OPENAI_API_KEY", file: path.join(root, "cwd", ".env"), by: "shell" },
      { name: "OPENAI_API_KEY", file: path.join(root, "pkg", ".env"), by: "shell" },
      { name: "SHARED", file: path.join(root, "pkg", ".env"), by: "cwd" },
    ]);
  });

  it("skips the cwd file when it is the package file and tolerates missing files", () => {
    const root = tmp({ "pkg/.env": "A=1\n" });
    const env: NodeJS.ProcessEnv = {};
    const report = loadEvalsEnv({
      packageRoot: path.join(root, "pkg"),
      cwd: path.join(root, "pkg"),
      env,
    });
    expect(report.files).toHaveLength(1);
    expect(env.A).toBe("1");

    __resetEvalsEnvForTests();
    const missing = loadEvalsEnv({
      packageRoot: path.join(root, "nope"),
      cwd: path.join(root, "also-nope"),
      env: {},
    });
    expect(missing.files.every((f) => !f.loaded)).toBe(true);
  });

  it("honours EVALS_DISABLE_PACKAGE_ENV=1 and caches the report", () => {
    const root = tmp({ "pkg/.env": "A=1\n", "cwd/.env": "B=2\n" });
    const env: NodeJS.ProcessEnv = { EVALS_DISABLE_PACKAGE_ENV: "1" };
    expect(
      resolveEnvFiles({
        packageRoot: path.join(root, "pkg"),
        cwd: path.join(root, "cwd"),
        env,
      }).map((f) => f.kind),
    ).toEqual(["cwd"]);
    const first = loadEvalsEnv({
      packageRoot: path.join(root, "pkg"),
      cwd: path.join(root, "cwd"),
      env,
    });
    expect(env.A).toBeUndefined();
    expect(env.B).toBe("2");
    expect(loadEvalsEnv()).toBe(first);
  });
});
