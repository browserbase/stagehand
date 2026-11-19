import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../oxlint.config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
type Diagnostic = { filename: string; code?: string; severity: string; message: string };
let directory: string;
let diagnostics: Diagnostic[];

const rejected = [
  ["eval.js", 'eval("source");', "eslint(no-eval)"],
  ["indirect.mjs", '(0, eval)("source");', "eslint(no-eval)"],
  [
    "eval-expression.ts",
    "export const run = (source: string) => eval(source);",
    "stagehand(no-dynamic-code)",
  ],
  [
    "shadowed-eval.cjs",
    "function run(eval, source) { return eval(source); } module.exports = run;",
    "stagehand(no-dynamic-code)",
  ],
  ["function.js", 'Function("return 1");', "stagehand(no-dynamic-code)"],
  ["new-function.mjs", 'new Function("return 1");', "stagehand(no-dynamic-code)"],
  ["global-function.ts", 'globalThis.Function("return 1");', "stagehand(no-dynamic-code)"],
  [
    "shadowed-function.ts",
    'export const run = (Function: (s: string) => unknown) => Function("source");',
    "stagehand(no-dynamic-code)",
  ],
  [
    "shadowed-global.ts",
    'export const run = (globalThis: { Function: (s: string) => unknown }) => globalThis.Function("source");',
    "stagehand(no-dynamic-code)",
  ],
  ["timeout.cjs", 'setTimeout("source", 10);', "eslint(no-implied-eval)"],
  ["interval.mjs", 'setInterval("source", 10);', "eslint(no-implied-eval)"],
  [
    "caught.ts",
    'try { JSON.parse(""); } catch (error) { console.log(error); throw new Error("failed"); }',
    "eslint(preserve-caught-error)",
  ],
  ["any.ts", "export const value: any = 1;", "typescript(no-explicit-any)"],
  ["unused.ts", "export const run = (_unused: string) => 1;", "eslint(no-unused-vars)"],
  ["unknown.js", "missingGlobal();", "eslint(no-undef)"],
  ["debugger.cjs", "debugger;", "eslint(no-debugger)"],
  ["var.ts", "export var value = 1;", "eslint(no-var)"],
  ["array.ts", "export const value = new Array(1, 2);", "eslint(no-array-constructor)"],
  [
    "expression.ts",
    "export const run = (value: unknown) => { value!; };",
    "eslint(no-unused-expressions)",
  ],
] as const;

const ignored = [
  "dist/invalid.ts",
  "node_modules/invalid/index.js",
  "coverage/invalid.js",
  "out/invalid.mjs",
  ".cache/invalid.cjs",
  ".browserbase/invalid.ts",
  "src/.browserbase/invalid.js",
];

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "stagehand-cli-lint-"));
  // Use the production overrides and ignores, but syntax-only fixtures do not
  // need a TypeScript project or the independent type-aware rule suite.
  await writeFile(
    path.join(directory, ".oxlintrc.json"),
    JSON.stringify({
      ...config,
      options: { ...config.options, typeAware: false },
      jsPlugins: [
        { name: "stagehand", specifier: path.join(root, "rules/oxlint/stagehand-plugin.ts") },
      ],
    }),
  );
  const fixtures: Record<string, string> = {
    ...Object.fromEntries(rejected.map(([name, source]) => [`packages/cli/src/${name}`, source])),
    ...Object.fromEntries(ignored.map((name) => [`packages/cli/${name}`, "eval(source);"])),
    "packages/cli/src/valid.ts":
      'export const run = (source: string) => { setTimeout(() => JSON.parse(source), 10); try { return JSON.parse(source); } catch (cause) { throw new Error("failed", { cause }); } };',
    "packages/cli/bin/valid.mjs":
      'import { basename } from "node:path"; console.log(basename(process.cwd()));',
    "packages/cli/bin/valid.cjs":
      "console.log(process.cwd(), __dirname, module.filename, 0o123, 0, 123);",
    "packages/cli/tests/globals.ts":
      'describe("example", () => { it("works", () => { expect(process.pid).toBeGreaterThan(0); }); });',
    "packages/cli/src/duplicate.cjs":
      "function run(value, value) { return value; } module.exports = run;",
    "packages/cli/src/octal.cjs": "module.exports = 0123;",
    "packages/other/outside.js": 'eval("source");',
  };
  for (const [name, source] of Object.entries(fixtures)) {
    const file = path.join(directory, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
  }
  const result = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/oxlint/bin/oxlint"), "--format", "json", "."],
    { cwd: directory, encoding: "utf8", timeout: 20_000 },
  );
  expect(result.error).toBeUndefined();
  expect([0, 1], result.stderr).toContain(result.status);
  diagnostics = JSON.parse(result.stdout).diagnostics;
}, 30_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("CLI Oxlint migration", () => {
  it.each(rejected)("rejects %s", (name, _source, code) => {
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: `packages/cli/src/${name}`, code, severity: "error" }),
      ]),
    );
  });

  it("accepts safe callbacks, preserved error causes, and Node/Vitest globals", () => {
    const valid = [
      "packages/cli/src/valid.ts",
      "packages/cli/bin/valid.mjs",
      "packages/cli/bin/valid.cjs",
      "packages/cli/tests/globals.ts",
    ];
    expect(diagnostics.filter((entry) => valid.includes(entry.filename))).toEqual([]);
  });

  it("ignores CLI build outputs and Browserbase working directories", () => {
    const paths = ignored.map((name) => `packages/cli/${name}`);
    expect(diagnostics.filter((entry) => paths.includes(entry.filename))).toEqual([]);
  });

  it("keeps the dynamic-code policy scoped to the CLI", () => {
    expect(
      diagnostics.filter(
        (entry) => entry.filename === "packages/other/outside.js" && entry.severity === "error",
      ),
    ).toEqual([]);
  });

  it.each([
    ["duplicate.cjs", "eslint(no-redeclare)"],
    ["octal.cjs", "stagehand(no-legacy-octal)"],
  ])("rejects legacy syntax in %s", (name, code) => {
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: `packages/cli/src/${name}`, code, severity: "error" }),
      ]),
    );
  });
});
